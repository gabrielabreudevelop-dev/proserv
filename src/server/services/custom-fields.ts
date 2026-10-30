/** Definições de campos personalizados. Criar um campo é um INSERT — sem migração. */
import { prisma } from "@/lib/db";
import { slugifyKey, type FieldDef, type FieldTypeName } from "@/lib/custom-fields";
import { DomainError } from "./errors";

const ENTITY = "product";

type Row = Awaited<ReturnType<typeof prisma.customFieldDefinition.findFirstOrThrow>>;

function toDef(r: Row): FieldDef {
  return {
    id: r.id,
    key: r.key,
    label: r.label,
    type: r.type as FieldTypeName,
    options: Array.isArray(r.options) ? (r.options as string[]) : [],
    required: r.required,
    visibleByDefault: r.visibleByDefault,
    position: r.position,
    archived: r.archivedAt !== null,
  };
}

export async function listFieldDefs({ includeArchived = false } = {}) {
  const rows = await prisma.customFieldDefinition.findMany({
    where: { entity: ENTITY, ...(includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { position: "asc" }, { createdAt: "asc" }],
  });
  return rows.map(toDef);
}

export type FieldDefInput = {
  label: string;
  type: FieldTypeName;
  options: string[];
  required: boolean;
  visibleByDefault: boolean;
};

function validate(input: FieldDefInput) {
  if (!input.label.trim()) throw new DomainError("Informe o nome do campo.", { label: "Obrigatório" });
  if (input.type === "SELECT" && input.options.length < 2) {
    throw new DomainError("Uma lista precisa de pelo menos 2 opções.", { options: "Pelo menos 2 opções" });
  }
}

export async function createFieldDef(input: FieldDefInput) {
  validate(input);
  const all = await prisma.customFieldDefinition.findMany({ where: { entity: ENTITY }, select: { key: true, label: true, position: true, archivedAt: true } });
  const label = input.label.trim();
  if (all.some((d) => d.archivedAt === null && d.label.toLowerCase() === label.toLowerCase())) {
    throw new DomainError(`Já existe um campo chamado "${label}".`, { label: "Nome já usado" });
  }
  const key = slugifyKey(label, all.map((d) => d.key));
  const position = all.reduce((m, d) => Math.max(m, d.position), -1) + 1;
  const row = await prisma.customFieldDefinition.create({
    data: {
      entity: ENTITY,
      key,
      label,
      type: input.type,
      options: input.type === "SELECT" ? input.options : undefined,
      required: input.required,
      visibleByDefault: input.visibleByDefault,
      position,
    },
  });
  return toDef(row);
}

/** O tipo não muda depois de criado: valores já gravados ficariam inválidos. */
export async function updateFieldDef(id: string, input: Omit<FieldDefInput, "type">) {
  const current = await prisma.customFieldDefinition.findUnique({ where: { id } });
  if (!current) throw new DomainError("Campo não encontrado.");
  validate({ ...input, type: current.type as FieldTypeName });
  const label = input.label.trim();
  const clash = await prisma.customFieldDefinition.findFirst({
    where: { entity: ENTITY, archivedAt: null, id: { not: id }, label: { equals: label, mode: "insensitive" } },
  });
  if (clash) throw new DomainError(`Já existe um campo chamado "${label}".`, { label: "Nome já usado" });
  const row = await prisma.customFieldDefinition.update({
    where: { id },
    data: {
      label,
      options: current.type === "SELECT" ? input.options : undefined,
      required: input.required,
      visibleByDefault: input.visibleByDefault,
    },
  });
  return toDef(row);
}

/** Arquivar esconde o campo, mas mantém os valores gravados nos produtos. */
export async function setFieldArchived(id: string, archived: boolean) {
  const row = await prisma.customFieldDefinition.update({
    where: { id },
    data: { archivedAt: archived ? new Date() : null },
  });
  return toDef(row);
}

/** Move um campo uma posição para cima ou para baixo (define a ordem das colunas). */
export async function moveFieldDef(id: string, direction: "up" | "down") {
  const defs = await listFieldDefs();
  const i = defs.findIndex((d) => d.id === id);
  const j = direction === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= defs.length) return;
  const reordered = [...defs];
  [reordered[i], reordered[j]] = [reordered[j], reordered[i]];
  await prisma.$transaction(
    reordered.map((d, position) => prisma.customFieldDefinition.update({ where: { id: d.id }, data: { position } })),
  );
}

/** Quantos produtos têm valor em cada chave — uma única consulta sobre o JSONB. */
export async function countFieldUsage(): Promise<Record<string, number>> {
  const rows = await prisma.$queryRaw<{ key: string; n: bigint }[]>`
    SELECT k AS key, COUNT(*) AS n
    FROM "Product", jsonb_object_keys("customFields") AS k
    GROUP BY k`;
  return Object.fromEntries(rows.map((r) => [r.key, Number(r.n)]));
}

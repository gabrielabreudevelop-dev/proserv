/**
 * Campos personalizados: regras puras (sem banco), usadas no servidor para validar
 * e no cliente para montar formulários e colunas.
 */
import { z } from "zod";
import { parseDecimalInput } from "./format";

export const FIELD_TYPES = ["TEXT", "NUMBER", "DATE", "BOOLEAN", "SELECT"] as const;
export type FieldTypeName = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_LABELS: Record<FieldTypeName, string> = {
  TEXT: "Texto",
  NUMBER: "Número",
  DATE: "Data",
  BOOLEAN: "Sim/Não",
  SELECT: "Lista de opções",
};

export type FieldDef = {
  id: string;
  key: string;
  label: string;
  type: FieldTypeName;
  options: string[];
  required: boolean;
  visibleByDefault: boolean;
  position: number;
  archived: boolean;
};

export type CustomValues = Record<string, string | number | boolean>;

/** Chaves que colidiriam com colunas fixas da tabela. */
const RESERVED_KEYS = new Set(["id", "sku", "name", "nome", "category", "categoria", "saleprice", "avgcost", "stockqty", "minstock", "active", "select", "actions", "expand"]);

/** "Data de Vencimento" → "data_de_vencimento"; garante unicidade com sufixo _2, _3… */
export function slugifyKey(label: string, existing: Iterable<string> = []) {
  const base =
    label
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40) || "campo";
  const taken = new Set(existing);
  let key = RESERVED_KEYS.has(base.replace(/_/g, "")) ? `${base}_campo` : base;
  for (let i = 2; taken.has(key); i++) key = `${base}_${i}`;
  return key;
}

/** Normaliza opções de SELECT digitadas em linhas ou separadas por vírgula. */
export function parseOptions(raw: string): string[] {
  const seen = new Set<string>();
  return raw
    .split(/[\n,;]/)
    .map((o) => o.trim())
    .filter((o) => o && !seen.has(o.toLowerCase()) && seen.add(o.toLowerCase()));
}

/** "2027-02-30" é rejeitado: a data precisa existir no calendário. */
export function isValidISODate(s: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
}

const blankToUndefined =(v: unknown) => (v === "" || v === null ? undefined : v);

function valueSchema(def: FieldDef) {
  switch (def.type) {
    case "TEXT":
      return z.string().trim().max(200, "Máximo de 200 caracteres");
    case "NUMBER":
      return z
        .union([z.string(), z.number()])
        .transform((v, ctx) => {
          const parsed = parseDecimalInput(v);
          if (parsed === null) {
            ctx.addIssue({ code: "custom", message: "Informe um número" });
            return z.NEVER;
          }
          return Number(parsed);
        });
    case "DATE":
      return z.string().refine((s) => isValidISODate(s), "Data inválida");
    case "BOOLEAN":
      return z.union([z.boolean(), z.enum(["true", "false", "on"])]).transform((v) => v === true || v === "true" || v === "on");
    case "SELECT":
      return z.string().refine((v) => def.options.includes(v), "Escolha uma das opções");
  }
}

/**
 * Monta o schema Zod para os valores de campos personalizados ativos.
 * Campos vazios são removidos; obrigatórios vazios geram erro.
 */
export function buildCustomFieldsSchema(defs: FieldDef[]) {
  const shape: Record<string, z.ZodType> = {};
  for (const def of defs.filter((d) => !d.archived)) {
    const base = valueSchema(def);
    shape[def.key] = def.required
      ? z
          .preprocess(blankToUndefined, z.unknown())
          .refine((v) => v !== undefined, { error: `${def.label} é obrigatório`, abort: true })
          .pipe(base)
      : z.preprocess(blankToUndefined, base.optional());
  }
  return z.object(shape).strip();
}

/**
 * Junta os valores novos aos existentes. Valores de campos arquivados são preservados
 * (não aparecem no formulário, mas não se perdem); campos ativos vazios são removidos.
 */
export function mergeCustomValues(existing: CustomValues, incoming: CustomValues, defs: FieldDef[]): CustomValues {
  const active = new Set(defs.filter((d) => !d.archived).map((d) => d.key));
  const result: CustomValues = {};
  for (const [k, v] of Object.entries(existing ?? {})) if (!active.has(k)) result[k] = v;
  for (const [k, v] of Object.entries(incoming)) if (active.has(k) && v !== undefined) result[k] = v;
  return result;
}

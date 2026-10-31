"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { FIELD_TYPE_LABELS, FIELD_TYPES, parseOptions } from "@/lib/custom-fields";
import { createFieldDef, moveFieldDef, setFieldArchived, updateFieldDef } from "@/server/services/custom-fields";
import { auditAfter, guardedAction } from "./result";

const PERM = { resource: "campo", action: "gerenciar" } as const;

const baseSchema = z.object({
  label: z.string().trim().min(1, "Informe o nome").max(40, "Máximo de 40 caracteres"),
  options: z
    .union([z.string(), z.array(z.string())])
    .default([])
    .transform((v) => (Array.isArray(v) ? parseOptions(v.join("\n")) : parseOptions(v))),
  required: z.boolean().default(false),
  visibleByDefault: z.boolean().default(true),
});

function revalidate() {
  revalidatePath("/produtos");
  revalidatePath("/produtos/campos");
}

export async function createFieldAction(input: unknown) {
  return guardedAction(PERM, baseSchema.extend({ type: z.enum(FIELD_TYPES) }), input, async (data, session) => {
    const def = await createFieldDef(data);
    await auditAfter(session, { action: "campo.criar", entity: "CustomFieldDefinition", entityId: def.id, summary: `Criou o campo "${def.label}" (${FIELD_TYPE_LABELS[def.type]})` });
    revalidate();
    return def;
  });
}

export async function updateFieldAction(id: string, input: unknown) {
  return guardedAction(PERM, baseSchema, input, async (data, session) => {
    const def = await updateFieldDef(id, data);
    await auditAfter(session, { action: "campo.editar", entity: "CustomFieldDefinition", entityId: id, summary: `Editou o campo "${def.label}"` });
    revalidate();
    return def;
  });
}

export async function archiveFieldAction(id: string, archived: boolean) {
  return guardedAction(PERM, z.boolean(), archived, async (value, session) => {
    const def = await setFieldArchived(id, value);
    await auditAfter(session, { action: value ? "campo.arquivar" : "campo.restaurar", entity: "CustomFieldDefinition", entityId: id, summary: `${value ? "Arquivou" : "Restaurou"} o campo "${def.label}"` });
    revalidate();
    return undefined;
  });
}

export async function moveFieldAction(id: string, direction: "up" | "down") {
  return guardedAction(PERM, z.enum(["up", "down"]), direction, async (dir) => {
    await moveFieldDef(id, dir);
    revalidate();
    return undefined;
  });
}

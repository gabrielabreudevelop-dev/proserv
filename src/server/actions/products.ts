"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createProduct, setProductActive, updateProduct } from "@/server/services/products";
import { listMovements, registerStockAdjustment, registerStockEntry, ADJUSTMENT_REASONS, type AdjustmentReason } from "@/server/services/stock";
import { saveTablePref, tableStateSchema } from "@/server/services/table-prefs";
import { auditAfter, decimalField, guardedAction, optionalDecimal } from "./result";
import { formatBRL } from "@/lib/format";
import { DomainError } from "@/server/services/errors";
import { can } from "@/lib/auth/permissions";

const productSchema = z.object({
  sku: z
    .string()
    .trim()
    .min(1, "Informe o SKU")
    .max(40, "Máximo de 40 caracteres")
    .regex(/^[A-Za-z0-9._-]+$/, "Use letras, números, ponto, hífen ou _"),
  name: z.string().trim().min(2, "Informe o nome").max(120, "Máximo de 120 caracteres"),
  category: z.string().trim().max(60).optional(),
  salePrice: decimalField("preço"),
  minStock: optionalDecimal("quantidade"),
  customFields: z.record(z.string(), z.unknown()).default({}),
});

const newProductSchema = productSchema.extend({
  initialQty: optionalDecimal("quantidade"),
  initialCost: optionalDecimal("custo"),
});

const PATH = "/produtos";

export async function createProductAction(input: unknown) {
  return guardedAction({ resource: "produto", action: "criar" }, newProductSchema, input, async (data, session) => {
    if (data.initialQty && Number(data.initialQty) > 0 && data.initialCost === undefined) {
      throw new DomainError("Informe o custo unitário do estoque inicial.", { initialCost: "Obrigatório com estoque inicial" });
    }
    const product = await createProduct(data, session.user.id);
    await auditAfter(session, {
      action: "produto.criar",
      entity: "Product",
      entityId: product!.id,
      summary: `Cadastrou o produto ${product!.sku} · "${product!.name}" a ${formatBRL(data.salePrice)}`,
    });
    revalidatePath(PATH);
    return { id: product!.id };
  });
}

export async function updateProductAction(id: string, input: unknown) {
  return guardedAction({ resource: "produto", action: "editar" }, productSchema, input, async (data, session) => {
    const { name, changes } = await updateProduct(id, data);
    if (Object.keys(changes).length) {
      await auditAfter(session, { action: "produto.editar", entity: "Product", entityId: id, summary: `Editou "${name}": ${Object.keys(changes).join(", ")}`, changes });
    }
    revalidatePath(PATH);
    return undefined;
  });
}

export async function setProductActiveAction(id: string, active: boolean) {
  return guardedAction({ resource: "produto", action: "editar" }, z.boolean(), active, async (value, session) => {
    const p = await setProductActive(id, value);
    await auditAfter(session, { action: value ? "produto.reativar" : "produto.desativar", entity: "Product", entityId: id, summary: `${value ? "Reativou" : "Desativou"} o produto ${p.sku} · "${p.name}"` });
    revalidatePath(PATH);
    return undefined;
  });
}

const entrySchema = z.object({
  productId: z.string().min(1),
  quantity: decimalField("quantidade", { min: 0.001 }),
  unitCost: decimalField("custo"),
  note: z.string().trim().max(200).optional(),
});

export async function stockEntryAction(input: unknown) {
  return guardedAction({ resource: "produto", action: "estoque" }, entrySchema, input, async (data, session) => {
    const { product } = await registerStockEntry({ ...data, userId: session.user.id });
    revalidatePath(PATH);
    return { stockQty: product.stockQty.toString(), avgCost: product.avgCost.toString() };
  });
}

const adjustmentSchema = z.object({
  productId: z.string().min(1),
  delta: decimalField("quantidade", { allowNegative: true }),
  reason: z.enum(Object.keys(ADJUSTMENT_REASONS) as [AdjustmentReason, ...AdjustmentReason[]]),
  note: z.string().trim().max(200).optional(),
});

export async function stockAdjustmentAction(input: unknown) {
  return guardedAction({ resource: "produto", action: "estoque" }, adjustmentSchema, input, async (data, session) => {
    const { product, ledgerEntry } = await registerStockAdjustment({ ...data, userId: session.user.id });
    revalidatePath(PATH);
    return { stockQty: product.stockQty.toString(), loss: ledgerEntry ? ledgerEntry.amount.abs().toString() : null };
  });
}

export async function getMovementsAction(productId: string) {
  return guardedAction({ resource: "produto", action: "ver" }, z.string().min(1), productId, async (id, session) =>
    // Custo só sai do servidor para quem pode ver o financeiro.
    listMovements(id, { includeCost: can(session.user.role, "financeiro", "ver") }),
  );
}

export async function saveProductTablePrefAction(state: unknown) {
  return guardedAction({ resource: "produto", action: "ver" }, tableStateSchema, state, async (data, session) => {
    await saveTablePref(session.user.id, "products", data);
    return undefined;
  });
}

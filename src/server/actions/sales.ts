"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/finance-shared";
import { cancelSale, createSale } from "@/server/services/sales";
import { decimalField, guardedAction } from "./result";

const saleSchema = z.object({
  items: z
    .array(z.object({ productId: z.string().min(1), quantity: decimalField("quantidade", { min: 0.001 }) }))
    .min(1, "Adicione pelo menos um produto")
    .max(200),
  discount: z.preprocess((v) => (v === "" || v === null ? "0" : v), decimalField("desconto")),
  paymentMethod: z.enum(Object.keys(PAYMENT_METHODS) as [PaymentMethod, ...PaymentMethod[]], { error: "Escolha a forma de pagamento" }),
  /** Opcional: cliente cadastrado (id) ou novo (nome + telefone). */
  customer: z
    .union([z.object({ id: z.string().min(1) }), z.object({ name: z.string().trim().min(2, "Nome do cliente muito curto").max(80), phone: z.string().trim().max(20).optional() })])
    .nullish(),
});

function revalidate() {
  for (const p of ["/vendas", "/vendas/nova", "/produtos", "/financeiro", "/dashboard"]) revalidatePath(p);
  revalidatePath("/clientes", "layout");
}

export async function createSaleAction(input: unknown) {
  return guardedAction({ resource: "venda", action: "registrar" }, saleSchema, input, async (data, session) => {
    // O preço vem sempre do cadastro (servidor); o cliente só manda produto e quantidade.
    const { sale } = await createSale({ ...data, sellerId: session.user.id });
    revalidate();
    return { id: sale.id, number: sale.number, total: sale.total.toString() };
  });
}

export async function cancelSaleAction(input: unknown) {
  return guardedAction(
    { resource: "venda", action: "cancelar" },
    z.object({ saleId: z.string().min(1), reason: z.string().trim().min(3, "Descreva o motivo").max(200) }),
    input,
    async (data, session) => {
      const sale = await cancelSale({ ...data, userId: session.user.id });
      revalidate();
      return { number: sale.number };
    },
  );
}

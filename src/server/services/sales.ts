/**
 * Vendas.
 *
 * Uma venda concluída grava, na MESMA transação:
 *  - Sale + SaleItem (com o custo médio do momento congelado em `unitCost`)
 *  - baixa de estoque (StockMovement SAIDA_VENDA) — nunca deixa estoque negativo
 *  - RECEITA_PRODUTO = total líquido (já com desconto)            (+)
 *  - CMV             = Σ quantidade × custo médio do momento       (−)
 *
 * Cancelar devolve o estoque ao custo congelado e grava ESTORNOS que anulam a
 * receita e o CMV na data do cancelamento (cada estorno aponta para o original).
 */
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { PAYMENT_METHODS, REVERSAL_CATEGORY, type PaymentMethod } from "@/lib/finance-shared";
import { DomainError } from "./errors";
import { nextAverageCost } from "./stock";

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);

export type SaleItemInput = { productId: string; quantity: string };
export type NewSaleInput = {
  items: SaleItemInput[];
  discount?: string;
  paymentMethod: PaymentMethod;
  sellerId: string;
  /** Só para testes/importação: data da venda. Padrão: agora. */
  at?: Date;
};

type Locked = { id: string; name: string; sku: string; salePrice: Prisma.Decimal; avgCost: Prisma.Decimal; stockQty: Prisma.Decimal; active: boolean };

/** Trava os produtos em ordem de id (ordem fixa evita deadlock entre vendas simultâneas). */
async function lockProducts(tx: Prisma.TransactionClient, ids: string[]) {
  const sorted = [...new Set(ids)].sort();
  const rows = await tx.$queryRaw<Locked[]>`
    SELECT id, name, sku, "salePrice", "avgCost", "stockQty", active
    FROM "Product" WHERE id IN (${Prisma.join(sorted)}) ORDER BY id FOR UPDATE`;
  return new Map(rows.map((r) => [r.id, r]));
}

export async function createSale(input: NewSaleInput) {
  if (input.items.length === 0) throw new DomainError("Adicione pelo menos um produto.");
  if (!(input.paymentMethod in PAYMENT_METHODS)) throw new DomainError("Forma de pagamento inválida.");

  // Junta linhas repetidas do mesmo produto.
  const qtyById = new Map<string, Prisma.Decimal>();
  for (const it of input.items) {
    const q = D(it.quantity);
    if (q.lte(0)) throw new DomainError("Quantidades devem ser maiores que zero.");
    qtyById.set(it.productId, (qtyById.get(it.productId) ?? D(0)).add(q));
  }
  const at = input.at ?? new Date();

  return prisma.$transaction(async (tx) => {
    const products = await lockProducts(tx, [...qtyById.keys()]);

    let subtotal = D(0);
    let cmv = D(0);
    const lines: { p: Locked; qty: Prisma.Decimal; lineTotal: Prisma.Decimal; lineCost: Prisma.Decimal }[] = [];
    for (const [id, qty] of qtyById) {
      const p = products.get(id);
      if (!p || !p.active) throw new DomainError("Um dos produtos não está mais disponível.");
      if (D(p.stockQty).lt(qty)) {
        throw new DomainError(`Estoque insuficiente de "${p.name}": há ${D(p.stockQty).toString()} e a venda pede ${qty.toString()}.`);
      }
      const lineTotal = qty.mul(p.salePrice).toDecimalPlaces(2);
      const lineCost = qty.mul(p.avgCost).toDecimalPlaces(2);
      subtotal = subtotal.add(lineTotal);
      cmv = cmv.add(lineCost);
      lines.push({ p, qty, lineTotal, lineCost });
    }

    const discount = D(input.discount || 0).toDecimalPlaces(2);
    if (discount.lt(0)) throw new DomainError("O desconto não pode ser negativo.", { discount: "Não pode ser negativo" });
    if (discount.gt(subtotal)) throw new DomainError("O desconto não pode ser maior que o subtotal.", { discount: "Maior que o subtotal" });
    const total = subtotal.sub(discount);

    const sale = await tx.sale.create({
      data: {
        sellerId: input.sellerId,
        status: "CONCLUIDA",
        subtotal,
        discount,
        total,
        paymentMethod: input.paymentMethod,
        createdAt: at,
        items: {
          create: lines.map(({ p, qty }) => ({ productId: p.id, quantity: qty, unitPrice: p.salePrice, unitCost: p.avgCost })),
        },
      },
    });

    for (const { p, qty } of lines) {
      await tx.product.update({ where: { id: p.id }, data: { stockQty: D(p.stockQty).sub(qty) } });
      await tx.stockMovement.create({
        data: { productId: p.id, type: "SAIDA_VENDA", quantity: qty.neg(), unitCost: p.avgCost, saleId: sale.id, note: `Venda nº ${sale.number}`, createdById: input.sellerId, createdAt: at },
      });
    }

    const description = `Venda nº ${sale.number}`;
    await tx.ledgerEntry.create({
      data: { kind: "RECEITA_PRODUTO", amount: total, occurredAt: at, description, saleId: sale.id, createdById: input.sellerId },
    });
    if (cmv.gt(0)) {
      await tx.ledgerEntry.create({
        data: { kind: "CMV", amount: cmv.neg(), occurredAt: at, description, saleId: sale.id, createdById: input.sellerId },
      });
    }
    return { sale, cmv };
  });
}

export async function cancelSale({ saleId, userId, reason, at }: { saleId: string; userId: string; reason: string; at?: Date }) {
  if (!reason.trim()) throw new DomainError("Informe o motivo do cancelamento.", { reason: "Obrigatório" });
  const when = at ?? new Date();

  return prisma.$transaction(async (tx) => {
    const [locked] = await tx.$queryRaw<{ id: string; status: string }[]>`SELECT id, status FROM "Sale" WHERE id = ${saleId} FOR UPDATE`;
    if (!locked) throw new DomainError("Venda não encontrada.");
    if (locked.status !== "CONCLUIDA") throw new DomainError("Esta venda já foi cancelada.");

    const sale = await tx.sale.findUniqueOrThrow({ where: { id: saleId }, include: { items: true } });
    const products = await lockProducts(tx, sale.items.map((i) => i.productId));

    // Devolve ao estoque pelo custo congelado na venda (recalcula o custo médio).
    for (const item of sale.items) {
      const p = products.get(item.productId)!;
      const avgCost = nextAverageCost(p.stockQty, p.avgCost, item.quantity, item.unitCost);
      const stockQty = D(p.stockQty).add(item.quantity);
      await tx.product.update({ where: { id: p.id }, data: { stockQty, avgCost } });
      products.set(p.id, { ...p, stockQty, avgCost });
      await tx.stockMovement.create({
        data: { productId: p.id, type: "DEVOLUCAO", quantity: item.quantity, unitCost: item.unitCost, saleId, note: `Cancelamento da venda nº ${sale.number}`, createdById: userId, createdAt: when },
      });
    }

    // Estorna cada lançamento da venda ainda não estornado.
    const entries = await tx.ledgerEntry.findMany({ where: { saleId, kind: { in: ["RECEITA_PRODUTO", "CMV"] } } });
    for (const e of entries) {
      await tx.ledgerEntry.create({
        data: {
          kind: "ESTORNO",
          amount: D(e.amount).neg(),
          occurredAt: when,
          description: `Cancelamento da venda nº ${sale.number}: ${reason.trim()}`,
          category: e.kind === "CMV" ? REVERSAL_CATEGORY.cmv : REVERSAL_CATEGORY.receita,
          saleId,
          reversesId: e.id,
          createdById: userId,
        },
      });
    }

    return tx.sale.update({
      where: { id: saleId },
      data: { status: "CANCELADA", cancelledAt: when, cancelledById: userId, cancelReason: reason.trim() },
    });
  });
}

export type SaleListRow = {
  id: string;
  number: number;
  createdAt: string;
  seller: string;
  status: "ABERTA" | "CONCLUIDA" | "CANCELADA";
  paymentMethod: string;
  itemsCount: number;
  subtotal: string;
  discount: string;
  total: string;
  /** Só para quem vê o financeiro. */
  cost?: string;
  cancelReason: string | null;
  items: { name: string; sku: string; quantity: string; unitPrice: string; unitCost?: string }[];
};

export async function listSales({ from, to, sellerId, includeCost }: { from: Date; to: Date; sellerId?: string; includeCost: boolean }) {
  const rows = await prisma.sale.findMany({
    where: { createdAt: { gte: from, lt: to }, ...(sellerId ? { sellerId } : {}) },
    include: { seller: { select: { name: true } }, items: { include: { product: { select: { name: true, sku: true } } } } },
    orderBy: { createdAt: "desc" },
  });
  return rows.map<SaleListRow>((s) => {
    const cost = s.items.reduce((acc, i) => acc.add(i.quantity.mul(i.unitCost).toDecimalPlaces(2)), D(0));
    return {
      id: s.id,
      number: s.number,
      createdAt: s.createdAt.toISOString(),
      seller: s.seller.name,
      status: s.status,
      paymentMethod: PAYMENT_METHODS[s.paymentMethod as PaymentMethod] ?? s.paymentMethod,
      itemsCount: s.items.reduce((n, i) => n + i.quantity.toNumber(), 0),
      subtotal: s.subtotal.toString(),
      discount: s.discount.toString(),
      total: s.total.toString(),
      ...(includeCost ? { cost: cost.toString() } : {}),
      cancelReason: s.cancelReason,
      items: s.items.map((i) => ({
        name: i.product.name,
        sku: i.product.sku,
        quantity: i.quantity.toString(),
        unitPrice: i.unitPrice.toString(),
        ...(includeCost ? { unitCost: i.unitCost.toString() } : {}),
      })),
    };
  });
}

/** Produtos que podem ser vendidos no PDV (sem custo). */
export async function listSellableProducts() {
  const rows = await prisma.product.findMany({
    where: { active: true },
    select: { id: true, sku: true, name: true, salePrice: true, stockQty: true, category: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  return rows.map((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: p.category?.name ?? null,
    price: p.salePrice.toString(),
    stock: p.stockQty.toString(),
  }));
}
export type SellableProduct = Awaited<ReturnType<typeof listSellableProducts>>[number];

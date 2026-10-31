/**
 * Estoque e custo médio ponderado.
 *
 * Regras:
 * - Entrada: soma quantidade e recalcula o custo médio. Não gera lançamento na DRE
 *   (regime de competência: o custo vira CMV só quando o produto é vendido).
 * - Ajuste negativo (perda, vencimento, correção de contagem): baixa estoque ao custo
 *   médio e gera DESPESA no livro-razão.
 * - Ajuste positivo (correção de contagem): entra ao custo médio atual, sem lançamento.
 * - Estoque nunca fica negativo. A linha do produto é travada (FOR UPDATE) durante
 *   a operação para que duas entradas simultâneas não corrompam o custo médio.
 */
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { DomainError } from "./errors";
import { writeAudit } from "./audit";
import { formatBRL } from "@/lib/format";

type Tx = Prisma.TransactionClient;
type DecimalValue = string | number | Prisma.Decimal;
const D = (v: DecimalValue) => new Prisma.Decimal(v);

import { ADJUSTMENT_REASONS, type AdjustmentReason } from "@/lib/stock-shared";
export { ADJUSTMENT_REASONS, type AdjustmentReason };

/**
 * custoNovo = (qtdAtual × custoAtual + qtdEntrada × custoEntrada) / (qtdAtual + qtdEntrada)
 * Se o estoque atual for zero ou negativo, o custo da entrada passa a ser o custo médio.
 */
export function nextAverageCost(
  currentQty: DecimalValue,
  currentAvg: DecimalValue,
  inQty: DecimalValue,
  inCost: DecimalValue,
): Prisma.Decimal {
  const q = D(currentQty);
  const qIn = D(inQty);
  if (q.lte(0)) return D(inCost).toDecimalPlaces(4);
  return q.mul(currentAvg).add(qIn.mul(inCost)).div(q.add(qIn)).toDecimalPlaces(4);
}

async function lockProduct(tx: Tx, productId: string) {
  const rows = await tx.$queryRaw<{ id: string; stockQty: Prisma.Decimal; avgCost: Prisma.Decimal; name: string }[]>`
    SELECT id, "stockQty", "avgCost", name FROM "Product" WHERE id = ${productId} FOR UPDATE`;
  if (!rows[0]) throw new DomainError("Produto não encontrado.");
  return rows[0];
}

export type EntryInput = { productId: string; quantity: string; unitCost: string; note?: string; userId: string; /** Só testes/importação. */ at?: Date };

/** Aplica uma entrada dentro de uma transação existente (usado também no cadastro). */
export async function applyStockEntry(tx: Tx, input: EntryInput) {
  const quantity = D(input.quantity);
  const unitCost = D(input.unitCost);
  if (quantity.lte(0)) throw new DomainError("A quantidade deve ser maior que zero.", { quantity: "Maior que zero" });
  if (unitCost.lt(0)) throw new DomainError("O custo não pode ser negativo.", { unitCost: "Não pode ser negativo" });

  const p = await lockProduct(tx, input.productId);
  const avgCost = nextAverageCost(p.stockQty, p.avgCost, quantity, unitCost);
  const product = await tx.product.update({
    where: { id: p.id },
    data: { stockQty: D(p.stockQty).add(quantity), avgCost },
  });
  const movement = await tx.stockMovement.create({
    data: {
      productId: p.id,
      type: "ENTRADA",
      quantity,
      unitCost,
      note: input.note?.trim() || null,
      createdById: input.userId,
      ...(input.at ? { createdAt: input.at } : {}),
    },
  });
  await writeAudit(tx, {
    actorId: input.userId,
    action: "estoque.entrada",
    entity: "Product",
    entityId: p.id,
    summary: `Entrada de ${quantity.toString()} un. de "${p.name}" a ${formatBRL(unitCost.toString())} (custo médio ${formatBRL(D(p.avgCost).toFixed(2))} → ${formatBRL(avgCost.toFixed(2))})`,
  });
  return { product, movement };
}

export function registerStockEntry(input: EntryInput) {
  return prisma.$transaction((tx) => applyStockEntry(tx, input));
}

export type AdjustmentInput = {
  productId: string;
  /** Variação com sinal: "-3" baixa 3 unidades, "2" acrescenta 2. */
  delta: string;
  reason: AdjustmentReason;
  note?: string;
  userId: string;
  /** Só testes/importação. */
  at?: Date;
};

export async function registerStockAdjustment(input: AdjustmentInput) {
  const delta = D(input.delta);
  if (delta.isZero()) throw new DomainError("Informe uma quantidade diferente de zero.", { delta: "Diferente de zero" });
  if (delta.gt(0) && input.reason !== "CONTAGEM") {
    throw new DomainError("Perdas e vencimentos só podem reduzir o estoque.", { delta: "Use um valor negativo" });
  }

  return prisma.$transaction(async (tx) => {
    const p = await lockProduct(tx, input.productId);
    const newQty = D(p.stockQty).add(delta);
    if (newQty.lt(0)) {
      throw new DomainError(`Estoque insuficiente: há ${D(p.stockQty).toString()} unidade(s).`, { delta: "Maior que o estoque" });
    }

    const product = await tx.product.update({ where: { id: p.id }, data: { stockQty: newQty } });
    const note = [ADJUSTMENT_REASONS[input.reason], input.note?.trim()].filter(Boolean).join(" — ");
    const movement = await tx.stockMovement.create({
      data: { productId: p.id, type: "AJUSTE", quantity: delta, unitCost: p.avgCost, note, createdById: input.userId, createdAt: input.at ?? new Date() },
    });

    let ledgerEntry = null;
    if (delta.lt(0)) {
      const loss = delta.abs().mul(p.avgCost).toDecimalPlaces(2);
      if (loss.gt(0)) {
        ledgerEntry = await tx.ledgerEntry.create({
          data: {
            kind: "DESPESA",
            amount: loss.neg(),
            occurredAt: input.at ?? new Date(),
            description: `Baixa de estoque: ${p.name} (${delta.abs().toString()} un.)`,
            category: "Perda de estoque",
            stockMovementId: movement.id,
            createdById: input.userId,
          },
        });
      }
    }
    await writeAudit(tx, {
      actorId: input.userId,
      action: "estoque.ajuste",
      entity: "Product",
      entityId: p.id,
      summary: `Ajustou o estoque de "${p.name}": ${delta.gt(0) ? "+" : ""}${delta.toString()} un. (${note})${ledgerEntry ? ` · despesa de ${formatBRL(ledgerEntry.amount.abs().toString())}` : ""}`,
    });
    return { product, movement, ledgerEntry };
  });
}

export async function listMovements(productId: string, { includeCost, take = 10 }: { includeCost: boolean; take?: number }) {
  const rows = await prisma.stockMovement.findMany({
    where: { productId },
    orderBy: { createdAt: "desc" },
    take,
  });
  const userIds = [...new Set(rows.map((r) => r.createdById))];
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, name: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    quantity: r.quantity.toString(),
    unitCost: includeCost ? r.unitCost.toString() : null,
    note: r.note,
    createdAt: r.createdAt.toISOString(),
    createdBy: nameOf.get(r.createdById) ?? "—",
  }));
}
export type MovementRow = Awaited<ReturnType<typeof listMovements>>[number];

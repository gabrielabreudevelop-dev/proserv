/**
 * Financeiro: tudo vem do livro-razão (LedgerEntry). Lucro/Prejuízo nunca é guardado.
 *
 * DRE simplificada do período:
 *   Receita de produtos + Receita de serviços
 * − Cancelamentos (estornos de receita)
 * = Receita líquida
 * − CMV (CMV − estornos de CMV)
 * = Lucro bruto
 * − Despesas (despesas − estornos de despesa)
 * = Resultado (lucro se ≥ 0, prejuízo se < 0)
 */
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { REVERSAL_CATEGORY, type LedgerKindName } from "@/lib/finance-shared";
import { DomainError } from "./errors";

const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
const money = (d: Prisma.Decimal) => d.toDecimalPlaces(2).toFixed(2);

export type IncomeStatement = {
  receitaProdutos: string;
  receitaServicos: string;
  cancelamentos: string; // negativo
  receitaLiquida: string;
  cmv: string; // positivo = custo
  lucroBruto: string;
  despesas: string; // positivo = gasto
  resultado: string;
  margemBruta: number | null;
  despesasPorCategoria: { category: string; amount: string }[];
  vendasConcluidas: number;
};

export async function incomeStatement(from: Date, to: Date): Promise<IncomeStatement> {
  const where = { occurredAt: { gte: from, lt: to } };
  const [byKind, byReversal, expensesByCat, reversedExpensesByCat, salesCount] = await Promise.all([
    prisma.ledgerEntry.groupBy({ by: ["kind"], where: { ...where, kind: { not: "ESTORNO" } }, _sum: { amount: true } }),
    prisma.ledgerEntry.groupBy({ by: ["category"], where: { ...where, kind: "ESTORNO" }, _sum: { amount: true } }),
    prisma.ledgerEntry.groupBy({ by: ["category"], where: { ...where, kind: "DESPESA" }, _sum: { amount: true } }),
    // Estornos de despesa herdam a categoria da despesa original.
    prisma.$queryRaw<{ category: string | null; amount: Prisma.Decimal }[]>`
      SELECT o.category, SUM(e.amount) AS amount
      FROM "LedgerEntry" e JOIN "LedgerEntry" o ON o.id = e."reversesId"
      WHERE e.kind = 'ESTORNO' AND o.kind = 'DESPESA' AND e."occurredAt" >= ${from} AND e."occurredAt" < ${to}
      GROUP BY o.category`,
    prisma.sale.count({ where: { createdAt: { gte: from, lt: to }, status: "CONCLUIDA" } }),
  ]);

  const sumKind = (k: LedgerKindName) => D(byKind.find((r) => r.kind === k)?._sum.amount ?? 0);
  const sumRev = (c: string) => D(byReversal.find((r) => r.category === c)?._sum.amount ?? 0);

  const receitaProdutos = sumKind("RECEITA_PRODUTO");
  const receitaServicos = sumKind("RECEITA_SERVICO");
  const cancelamentos = sumRev(REVERSAL_CATEGORY.receita); // ≤ 0
  const receitaLiquida = receitaProdutos.add(receitaServicos).add(cancelamentos);
  const cmv = sumKind("CMV").add(sumRev(REVERSAL_CATEGORY.cmv)).neg(); // custo como positivo
  const lucroBruto = receitaLiquida.sub(cmv);
  const despesas = sumKind("DESPESA").add(sumRev(REVERSAL_CATEGORY.despesa)).neg();
  const resultado = lucroBruto.sub(despesas);

  const cats = new Map<string, Prisma.Decimal>();
  for (const r of expensesByCat) cats.set(r.category ?? "Outros", D(r._sum.amount ?? 0));
  for (const r of reversedExpensesByCat) {
    const k = r.category ?? "Outros";
    cats.set(k, (cats.get(k) ?? D(0)).add(r.amount));
  }

  return {
    receitaProdutos: money(receitaProdutos),
    receitaServicos: money(receitaServicos),
    cancelamentos: money(cancelamentos),
    receitaLiquida: money(receitaLiquida),
    cmv: money(cmv),
    lucroBruto: money(lucroBruto),
    despesas: money(despesas),
    resultado: money(resultado),
    margemBruta: receitaLiquida.gt(0) ? lucroBruto.div(receitaLiquida).toNumber() : null,
    despesasPorCategoria: [...cats.entries()]
      .map(([category, amount]) => ({ category, amount: money(amount.neg()) }))
      .filter((c) => D(c.amount).gt(0))
      .sort((a, b) => D(b.amount).cmp(D(a.amount))),
    vendasConcluidas: salesCount,
  };
}

export async function createExpense(input: { amount: string; category: string; description: string; occurredAt: Date; userId: string }) {
  const amount = D(input.amount).toDecimalPlaces(2);
  if (amount.lte(0)) throw new DomainError("O valor deve ser maior que zero.", { amount: "Maior que zero" });
  return prisma.ledgerEntry.create({
    data: {
      kind: "DESPESA",
      amount: amount.neg(),
      occurredAt: input.occurredAt,
      description: input.description.trim(),
      category: input.category.trim() || "Outros",
      createdById: input.userId,
    },
  });
}

/** Estorna uma despesa lançada à mão. Perdas de estoque se corrigem com ajuste de estoque. */
export async function reverseExpense({ entryId, userId, at }: { entryId: string; userId: string; at?: Date }) {
  return prisma.$transaction(async (tx) => {
    const [e] = await tx.$queryRaw<{ id: string; kind: string; amount: Prisma.Decimal; description: string; stockMovementId: string | null }[]>`
      SELECT id, kind, amount, description, "stockMovementId" FROM "LedgerEntry" WHERE id = ${entryId} FOR UPDATE`;
    if (!e) throw new DomainError("Lançamento não encontrado.");
    if (e.kind !== "DESPESA") throw new DomainError("Só despesas podem ser estornadas por aqui.");
    if (e.stockMovementId) throw new DomainError("Perdas de estoque se corrigem com um ajuste de estoque.");
    if (await tx.ledgerEntry.findUnique({ where: { reversesId: e.id } })) throw new DomainError("Esta despesa já foi estornada.");
    return tx.ledgerEntry.create({
      data: {
        kind: "ESTORNO",
        amount: D(e.amount).neg(),
        occurredAt: at ?? new Date(),
        description: `Estorno: ${e.description}`,
        category: REVERSAL_CATEGORY.despesa,
        reversesId: e.id,
        createdById: userId,
      },
    });
  });
}

export type LedgerRow = {
  id: string;
  kind: LedgerKindName;
  amount: string;
  occurredAt: string;
  description: string;
  category: string | null;
  createdBy: string;
  saleNumber: number | null;
  /** Despesa manual que ainda pode ser estornada. */
  reversible: boolean;
  reversed: boolean;
};

export async function listLedger({ from, to, kind }: { from: Date; to: Date; kind?: LedgerKindName }) {
  const rows = await prisma.ledgerEntry.findMany({
    where: { occurredAt: { gte: from, lt: to }, ...(kind ? { kind } : {}) },
    orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
    take: 500,
  });
  const ids = rows.map((r) => r.id);
  const [reversals, users, sales] = await Promise.all([
    prisma.ledgerEntry.findMany({ where: { reversesId: { in: ids } }, select: { reversesId: true } }),
    prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, name: true } }),
    prisma.sale.findMany({ where: { id: { in: rows.map((r) => r.saleId).filter((x): x is string => !!x) } }, select: { id: true, number: true } }),
  ]);
  const reversedSet = new Set(reversals.map((r) => r.reversesId));
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const saleNo = new Map(sales.map((s) => [s.id, s.number]));
  return rows.map<LedgerRow>((r) => ({
    id: r.id,
    kind: r.kind,
    amount: r.amount.toFixed(2),
    occurredAt: r.occurredAt.toISOString(),
    description: r.description,
    category: r.category,
    createdBy: nameOf.get(r.createdById) ?? "—",
    saleNumber: r.saleId ? (saleNo.get(r.saleId) ?? null) : null,
    reversible: r.kind === "DESPESA" && !r.stockMovementId && !reversedSet.has(r.id),
    reversed: reversedSet.has(r.id),
  }));
}

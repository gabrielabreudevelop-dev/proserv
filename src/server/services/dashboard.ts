/**
 * Números do dashboard. Tudo agregado no banco, com dias contados em Brasília.
 * "Últimos 7 dias" = hoje e os 6 dias anteriores; a comparação usa os 7 dias antes disso.
 */
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { REVERSAL_CATEGORY, currentMonth, monthRange } from "@/lib/finance-shared";
import { addDays, localParts, localRange } from "@/lib/time";
import { listAppointments, listOverdue, type AppointmentRow } from "./appointments";
import { incomeStatement } from "./finance";

const LOCAL_DAY = Prisma.sql`to_char(("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')`;
const LOCAL_DAY_OCC = Prisma.sql`to_char(("occurredAt" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD')`;

export type DayPoint = { date: string; value: number; count: number };

function fillDays(start: string, days: number, rows: { d: string; v: Prisma.Decimal | number | null; n?: bigint | number }[]): DayPoint[] {
  const by = new Map(rows.map((r) => [r.d, r]));
  return Array.from({ length: days }, (_, i) => {
    const date = addDays(start, i);
    const r = by.get(date);
    return { date, value: r ? Number(r.v ?? 0) : 0, count: r?.n !== undefined ? Number(r.n) : 0 };
  });
}

const pctChange = (now: number, before: number) => (before > 0 ? (now - before) / before : null);

export async function productsDashboard({ sellerId, includeProfit, now = new Date() }: { sellerId?: string; includeProfit: boolean; now?: Date }) {
  const today = localParts(now).date;
  const start14 = addDays(today, -13);
  const start7 = addDays(today, -6);
  const { from: from14 } = localRange(start14);
  const { to: end } = localRange(today);
  const seller = sellerId ? Prisma.sql`AND "sellerId" = ${sellerId}` : Prisma.empty;

  const [daily, top, lowStock, lowCount] = await Promise.all([
    prisma.$queryRaw<{ d: string; v: Prisma.Decimal; n: bigint }[]>`
      SELECT ${LOCAL_DAY} AS d, SUM(total) AS v, COUNT(*) AS n
      FROM "Sale" WHERE status = 'CONCLUIDA' AND "createdAt" >= ${from14} AND "createdAt" < ${end} ${seller}
      GROUP BY 1`,
    prisma.$queryRaw<{ name: string; sku: string; qty: Prisma.Decimal; revenue: Prisma.Decimal }[]>`
      SELECT p.name, p.sku, SUM(i.quantity) AS qty, SUM(i.quantity * i."unitPrice") AS revenue
      FROM "SaleItem" i JOIN "Sale" s ON s.id = i."saleId" JOIN "Product" p ON p.id = i."productId"
      WHERE s.status = 'CONCLUIDA' AND s."createdAt" >= ${localRange(start7).from} AND s."createdAt" < ${end}
      ${sellerId ? Prisma.sql`AND s."sellerId" = ${sellerId}` : Prisma.empty}
      GROUP BY p.id, p.name, p.sku ORDER BY qty DESC, revenue DESC LIMIT 5`,
    prisma.$queryRaw<{ id: string; name: string; sku: string; stockQty: Prisma.Decimal; minStock: Prisma.Decimal | null }[]>`
      SELECT id, name, sku, "stockQty", "minStock" FROM "Product"
      WHERE active AND ("stockQty" <= 0 OR ("minStock" IS NOT NULL AND "stockQty" <= "minStock"))
      ORDER BY ("stockQty" > 0), "stockQty" / NULLIF("minStock", 0) NULLS FIRST, name LIMIT 8`,
    prisma.$queryRaw<{ n: bigint }[]>`
      SELECT COUNT(*) AS n FROM "Product" WHERE active AND ("stockQty" <= 0 OR ("minStock" IS NOT NULL AND "stockQty" <= "minStock"))`,
  ]);

  const series = fillDays(start14, 14, daily);
  const last7 = series.slice(7);
  const prev7 = series.slice(0, 7);
  const revenue7 = last7.reduce((s, p) => s + p.value, 0);
  const count7 = last7.reduce((s, p) => s + p.count, 0);
  const revenuePrev = prev7.reduce((s, p) => s + p.value, 0);

  let month: { resultado: string; receitaLiquida: string } | null = null;
  if (includeProfit) {
    const { from, to } = monthRange(currentMonth(now));
    const dre = await incomeStatement(from, to);
    month = { resultado: dre.resultado, receitaLiquida: dre.receitaLiquida };
  }

  return {
    today,
    revenue7,
    count7,
    ticket7: count7 > 0 ? revenue7 / count7 : null,
    revenueChange: pctChange(revenue7, revenuePrev),
    series: last7.length ? series : [],
    top: top.map((t) => ({ name: t.name, sku: t.sku, qty: Number(t.qty), revenue: Number(t.revenue) })),
    lowStock: lowStock.map((p) => ({ id: p.id, name: p.name, sku: p.sku, stockQty: Number(p.stockQty), minStock: p.minStock === null ? null : Number(p.minStock) })),
    lowStockCount: Number(lowCount[0]?.n ?? 0),
    month,
  };
}
export type ProductsDashboard = Awaited<ReturnType<typeof productsDashboard>>;

export async function servicesDashboard({ providerId, includeMoney, now = new Date() }: { providerId?: string; includeMoney: boolean; now?: Date }) {
  const today = localParts(now).date;
  const start14 = addDays(today, -13);
  const { from: todayFrom, to: todayTo } = localRange(today);
  const { from: from7 } = localRange(addDays(today, -6));

  const [agenda, overdue, weekAppts] = await Promise.all([
    listAppointments({ from: todayFrom, to: todayTo, providerId, includeCancelled: false }),
    listOverdue({ now, providerId }),
    prisma.appointment.groupBy({
      by: ["status"],
      where: { startsAt: { gte: from7 }, endsAt: { lt: now }, ...(providerId ? { providerId } : {}) },
      _count: true,
    }),
  ]);

  const countOf = (s: string) => weekAppts.find((w) => w.status === s)?._count ?? 0;
  const doneWeek = countOf("CONCLUIDO");
  const missedWeek = countOf("AGENDADO") + countOf("EM_ANDAMENTO");
  const completionRate = doneWeek + missedWeek > 0 ? doneWeek / (doneWeek + missedWeek) : null;

  let money: { today: number; week: number; weekChange: number | null; series: DayPoint[] } | null = null;
  if (includeMoney) {
    // Receita de serviços líquida de estornos, por dia local.
    const rows = await prisma.$queryRaw<{ d: string; v: Prisma.Decimal }[]>`
      SELECT ${LOCAL_DAY_OCC} AS d, SUM(amount) AS v FROM "LedgerEntry"
      WHERE "occurredAt" >= ${localRange(start14).from} AND "occurredAt" < ${todayTo}
        AND (kind = 'RECEITA_SERVICO' OR (kind = 'ESTORNO' AND category = ${REVERSAL_CATEGORY.receita} AND "appointmentId" IS NOT NULL))
      GROUP BY 1`;
    const series = fillDays(start14, 14, rows);
    const week = series.slice(7).reduce((s, p) => s + p.value, 0);
    const prev = series.slice(0, 7).reduce((s, p) => s + p.value, 0);
    money = { today: series.at(-1)?.value ?? 0, week, weekChange: pctChange(week, prev), series };
  }

  const pendingToday = agenda.filter((a) => a.status === "AGENDADO" || a.status === "EM_ANDAMENTO");
  return {
    today,
    agenda,
    overdue,
    counts: { today: agenda.length, doneToday: agenda.filter((a) => a.status === "CONCLUIDO").length, pendingToday: pendingToday.length },
    nextUp: pendingToday.find((a) => new Date(a.endsAt) > now) ?? null,
    completionRate,
    money,
  };
}
export type ServicesDashboard = Awaited<ReturnType<typeof servicesDashboard>> & { agenda: AppointmentRow[] };

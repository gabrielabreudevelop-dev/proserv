/**
 * Clientes — usados pela agenda (principal) e, opcionalmente, pelas vendas.
 *
 * - Telefone é guardado só com dígitos.
 * - Juntar cadastros move atendimentos e compras para o cadastro que fica e apaga o outro.
 * - Excluir dados (LGPD): sem histórico, o cadastro é apagado; com histórico, nome,
 *   telefone, e-mail e observações são apagados e o cliente vira "Cliente removido".
 *   Valores e datas ficam, porque fazem parte da contabilidade.
 */
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { isValidPhone, normalizePhone } from "@/lib/phone";
import { DomainError } from "./errors";
import { writeAudit } from "./audit";
import { mergeFollowUps } from "./followups";

type Tx = Prisma.TransactionClient;
const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
export const REMOVED_NAME = "Cliente removido";
/** Sem atendimento concluído nem compra há este tempo (e nada agendado) = "sumido". */
export const INACTIVE_DAYS = 60;
const DAY_MS = 86_400_000;

// ── Referência usada por agenda e vendas ─────────────────
export type CustomerRef = { id: string } | { name: string; phone?: string };

/** Acha o cliente pelo id ou cadastra na hora (reaproveitando quem tem mesmo nome e telefone). */
export async function resolveCustomer(tx: Tx, c: CustomerRef) {
  if ("id" in c) {
    const found = await tx.customer.findUnique({ where: { id: c.id } });
    if (!found || found.anonymizedAt) throw new DomainError("Cliente não encontrado.", { customer: "Cliente não encontrado" });
    return found.id;
  }
  const name = c.name.trim();
  if (name.length < 2) throw new DomainError("Informe o nome do cliente.", { customer: "Obrigatório" });
  const phone = normalizePhone(c.phone);
  if (!isValidPhone(phone)) throw new DomainError("Telefone inválido.", { customerPhone: "Use DDD + número" });
  const existing = await tx.customer.findFirst({ where: { name: { equals: name, mode: "insensitive" }, phone, anonymizedAt: null } });
  return (existing ?? (await tx.customer.create({ data: { name, phone } }))).id;
}

/** Opções para os campos de busca da agenda e do PDV. */
export async function listCustomerOptions() {
  return prisma.customer.findMany({ where: { anonymizedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true, phone: true } });
}
export type CustomerOption = Awaited<ReturnType<typeof listCustomerOptions>>[number];

// ── Lista ────────────────────────────────────────────────
export type CustomerFilter = "todos" | "agendados" | "sumidos" | "novos";
export type CustomerSort = "nome" | "recentes" | "visitas" | "gasto";

export type CustomerSummary = {
  id: string;
  name: string;
  phone: string | null;
  /** Primeiro contato: cadastro, primeiro atendimento ou primeira compra (o que vier antes). */
  createdAt: string;
  visits: number;
  cancelled: number;
  lastVisit: string | null;
  nextAppointment: string | null;
  servicesTotal: string;
  purchases: number;
  productsTotal: string;
  /** Último atendimento concluído ou compra. */
  lastActivity: string | null;
};

type SummaryRow = {
  id: string;
  name: string;
  phone: string | null;
  createdAt: Date;
  visits: bigint;
  cancelled: bigint;
  lastVisit: Date | null;
  nextAt: Date | null;
  servicesTotal: Prisma.Decimal;
  purchases: bigint;
  productsTotal: Prisma.Decimal;
  lastPurchase: Date | null;
};

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Um cliente por linha com os números do histórico. Filtro e ordem rodam aqui (volume de pequeno negócio). */
export async function listCustomerSummaries({
  q = "",
  filter = "todos",
  sort = "nome",
  now = new Date(),
}: { q?: string; filter?: CustomerFilter; sort?: CustomerSort; now?: Date } = {}) {
  const rows = await prisma.$queryRaw<SummaryRow[]>`
    WITH a AS (
      SELECT "customerId",
        count(*) FILTER (WHERE status = 'CONCLUIDO') AS visits,
        count(*) FILTER (WHERE status = 'CANCELADO') AS cancelled,
        max("startsAt") FILTER (WHERE status = 'CONCLUIDO') AS "lastVisit",
        min("startsAt") FILTER (WHERE status IN ('AGENDADO', 'EM_ANDAMENTO') AND "endsAt" >= ${now}) AS "nextAt",
        coalesce(sum("chargedPrice") FILTER (WHERE status = 'CONCLUIDO'), 0) AS "servicesTotal",
        min("startsAt") AS "firstAppointment"
      FROM "Appointment" GROUP BY "customerId"
    ), s AS (
      SELECT "customerId", count(*) AS purchases, coalesce(sum(total), 0) AS "productsTotal", max("createdAt") AS "lastPurchase", min("createdAt") AS "firstPurchase"
      FROM "Sale" WHERE status = 'CONCLUIDA' AND "customerId" IS NOT NULL GROUP BY "customerId"
    )
    SELECT c.id, c.name, c.phone, least(c."createdAt", a."firstAppointment", s."firstPurchase") AS "createdAt",
      coalesce(a.visits, 0) AS visits, coalesce(a.cancelled, 0) AS cancelled, a."lastVisit", a."nextAt",
      coalesce(a."servicesTotal", 0) AS "servicesTotal",
      coalesce(s.purchases, 0) AS purchases, coalesce(s."productsTotal", 0) AS "productsTotal", s."lastPurchase"
    FROM "Customer" c
    LEFT JOIN a ON a."customerId" = c.id
    LEFT JOIN s ON s."customerId" = c.id
    WHERE c."anonymizedAt" IS NULL`;

  const all = rows.map<CustomerSummary>((r) => {
    const last = [r.lastVisit, r.lastPurchase].filter((d): d is Date => d !== null).sort((x, y) => y.getTime() - x.getTime())[0] ?? null;
    return {
      id: r.id,
      name: r.name,
      phone: r.phone,
      createdAt: r.createdAt.toISOString(),
      visits: Number(r.visits),
      cancelled: Number(r.cancelled),
      lastVisit: r.lastVisit?.toISOString() ?? null,
      nextAppointment: r.nextAt?.toISOString() ?? null,
      servicesTotal: D(r.servicesTotal).toFixed(2),
      purchases: Number(r.purchases),
      productsTotal: D(r.productsTotal).toFixed(2),
      lastActivity: last?.toISOString() ?? null,
    };
  });

  const counts = {
    todos: all.length,
    agendados: all.filter((c) => c.nextAppointment).length,
    sumidos: all.filter((c) => isInactive(c, now)).length,
    novos: all.filter((c) => isNew(c, now)).length,
  };

  const terms = fold(q.trim()).split(/\s+/).filter(Boolean);
  const digits = q.replace(/\D/g, "");
  let list = all.filter((c) => {
    if (filter === "agendados" && !c.nextAppointment) return false;
    if (filter === "sumidos" && !isInactive(c, now)) return false;
    if (filter === "novos" && !isNew(c, now)) return false;
    if (!terms.length) return true;
    if (digits.length >= 3 && c.phone?.includes(digits)) return true;
    const hay = fold(c.name);
    return terms.every((t) => hay.includes(t));
  });

  const time = (s: string | null) => (s ? new Date(s).getTime() : 0);
  const byName = (x: CustomerSummary, y: CustomerSummary) => x.name.localeCompare(y.name, "pt-BR");
  list = list.sort(
    sort === "recentes"
      ? (x, y) => time(y.lastActivity) - time(x.lastActivity) || byName(x, y)
      : sort === "visitas"
        ? (x, y) => y.visits - x.visits || byName(x, y)
        : sort === "gasto"
          ? (x, y) => D(y.servicesTotal).add(y.productsTotal).cmp(D(x.servicesTotal).add(x.productsTotal)) || byName(x, y)
          : byName,
  );
  return { customers: list, counts };
}

function isInactive(c: CustomerSummary, now: Date) {
  return c.lastActivity !== null && !c.nextAppointment && now.getTime() - new Date(c.lastActivity).getTime() > INACTIVE_DAYS * DAY_MS;
}
function isNew(c: CustomerSummary, now: Date) {
  return now.getTime() - new Date(c.createdAt).getTime() <= 30 * DAY_MS;
}

// ── Ficha ────────────────────────────────────────────────
export type CustomerDetail = Awaited<ReturnType<typeof getCustomerDetail>>;

export async function getCustomerDetail(id: string, { now = new Date() }: { now?: Date } = {}) {
  const c = await prisma.customer.findUnique({
    where: { id },
    include: {
      appointments: {
        include: { service: { select: { name: true } }, provider: { select: { name: true } } },
        orderBy: { startsAt: "desc" },
      },
      sales: {
        include: { items: { include: { product: { select: { name: true } } } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!c) return null;

  const done = c.appointments.filter((a) => a.status === "CONCLUIDO");
  const servicesTotal = done.reduce((s, a) => s.add(a.chargedPrice ?? 0), D(0));
  const salesDone = c.sales.filter((s) => s.status === "CONCLUIDA");
  const productsTotal = salesDone.reduce((s, x) => s.add(x.total), D(0));

  // Intervalo médio entre visitas concluídas (precisa de pelo menos duas).
  const visitTimes = done.map((a) => a.startsAt.getTime()).sort((x, y) => x - y);
  const avgIntervalDays = visitTimes.length >= 2 ? Math.round((visitTimes.at(-1)! - visitTimes[0]) / (visitTimes.length - 1) / DAY_MS) : null;

  const freq = new Map<string, number>();
  for (const a of done) freq.set(a.service.name, (freq.get(a.service.name) ?? 0) + 1);
  const favorite = [...freq.entries()].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))[0];

  const upcoming = c.appointments
    .filter((a) => (a.status === "AGENDADO" || a.status === "EM_ANDAMENTO") && a.endsAt >= now)
    .sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime());

  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    notes: c.notes,
    // Cliente desde: o primeiro contato (cadastros antigos podem ter sido feitos depois do 1º atendimento).
    createdAt: new Date(Math.min(c.createdAt.getTime(), ...c.appointments.map((a) => a.startsAt.getTime()), ...c.sales.map((x) => x.createdAt.getTime()))).toISOString(),
    anonymized: c.anonymizedAt !== null,
    stats: {
      visits: done.length,
      cancelled: c.appointments.filter((a) => a.status === "CANCELADO").length,
      servicesTotal: servicesTotal.toFixed(2),
      avgTicket: done.length ? servicesTotal.div(done.length).toFixed(2) : null,
      firstVisit: visitTimes.length ? new Date(visitTimes[0]).toISOString() : null,
      lastVisit: visitTimes.length ? new Date(visitTimes.at(-1)!).toISOString() : null,
      avgIntervalDays,
      favoriteService: favorite ? { name: favorite[0], count: favorite[1], id: done.find((a) => a.service.name === favorite[0])!.serviceId } : null,
      purchases: salesDone.length,
      productsTotal: productsTotal.toFixed(2),
      nextAppointment: upcoming[0]?.startsAt.toISOString() ?? null,
    },
    appointments: c.appointments.map((a) => ({
      id: a.id,
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt.toISOString(),
      status: a.status,
      service: a.service.name,
      provider: a.provider.name,
      chargedPrice: a.chargedPrice?.toFixed(2) ?? null,
      notes: a.notes,
      cancelReason: a.cancelReason,
    })),
    sales: c.sales.map((s) => ({
      id: s.id,
      number: s.number,
      createdAt: s.createdAt.toISOString(),
      status: s.status,
      total: s.total.toFixed(2),
      items: s.items.map((i) => `${D(i.quantity).toString().replace(".", ",")}× ${i.product.name}`).join(", "),
    })),
  };
}

// ── Cadastro ─────────────────────────────────────────────
export type CustomerInput = { name: string; phone?: string | null; email?: string | null; notes?: string | null };

function clean(input: CustomerInput) {
  const name = input.name.trim();
  if (name.length < 2) throw new DomainError("Informe o nome do cliente.", { name: "Obrigatório" });
  const phone = normalizePhone(input.phone);
  if (!isValidPhone(phone)) throw new DomainError("Telefone inválido.", { phone: "Use DDD + número" });
  return { name, phone, email: input.email?.trim().toLowerCase() || null, notes: input.notes?.trim() || null };
}

/** Mesmo nome e telefone = duplicado (bloqueia). Só o telefone igual = aviso (família costuma dividir número). */
async function checkDuplicates(data: { name: string; phone: string | null }, exceptId?: string) {
  if (!data.phone) return {};
  const same = await prisma.customer.findMany({
    where: { phone: data.phone, anonymizedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { id: true, name: true },
  });
  const twin = same.find((s) => fold(s.name) === fold(data.name));
  if (twin) throw new DomainError(`Já existe "${twin.name}" com este telefone.`, { phone: "Cliente já cadastrado" });
  return same.length ? { warning: `Este telefone também está no cadastro de ${same.map((s) => s.name).join(", ")}.` } : {};
}

export async function createCustomer(input: CustomerInput) {
  const data = clean(input);
  const { warning } = await checkDuplicates(data);
  const c = await prisma.customer.create({ data });
  return { id: c.id, warning };
}

export async function updateCustomer(id: string, input: CustomerInput) {
  const before = await prisma.customer.findUnique({ where: { id } });
  if (!before || before.anonymizedAt) throw new DomainError("Cliente não encontrado.");
  const data = clean(input);
  const { warning } = await checkDuplicates(data, id);
  await prisma.customer.update({ where: { id }, data });
  return { before, after: data, warning };
}

// ── Juntar cadastros ─────────────────────────────────────
export async function mergeCustomers({ sourceId, targetId, actorId }: { sourceId: string; targetId: string; actorId: string }) {
  if (sourceId === targetId) throw new DomainError("Escolha outro cadastro para juntar.", { targetId: "Mesmo cliente" });
  return prisma.$transaction(async (tx) => {
    // Trava os dois em ordem fixa (evita deadlock com uma junção ao contrário).
    const ids = [sourceId, targetId].sort();
    await tx.$queryRaw`SELECT id FROM "Customer" WHERE id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`;
    const [source, target] = await Promise.all([tx.customer.findUnique({ where: { id: sourceId } }), tx.customer.findUnique({ where: { id: targetId } })]);
    if (!source || source.anonymizedAt || !target || target.anonymizedAt) throw new DomainError("Cliente não encontrado.");

    const appts = await tx.appointment.updateMany({ where: { customerId: sourceId }, data: { customerId: targetId } });
    const sales = await tx.sale.updateMany({ where: { customerId: sourceId }, data: { customerId: targetId } });
    await mergeFollowUps(tx, sourceId, targetId, new Date());
    const notes = [target.notes, source.notes].filter(Boolean).join("\n") || null;
    await tx.customer.update({
      where: { id: targetId },
      data: { phone: target.phone ?? source.phone, email: target.email ?? source.email, notes },
    });
    await tx.customer.delete({ where: { id: sourceId } });

    const moved = [appts.count && `${appts.count} atendimento${appts.count > 1 ? "s" : ""}`, sales.count && `${sales.count} compra${sales.count > 1 ? "s" : ""}`].filter(Boolean);
    await writeAudit(tx, {
      actorId,
      action: "cliente.juntar",
      entity: "Customer",
      entityId: targetId,
      summary: `Juntou o cadastro "${source.name}" em "${target.name}"${moved.length ? ` (${moved.join(" e ")})` : ""}`,
    });
    return { appointments: appts.count, sales: sales.count, targetName: target.name };
  });
}

// ── LGPD: excluir dados pessoais ─────────────────────────
export async function eraseCustomer({ id, actorId }: { id: string; actorId: string }) {
  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${id} FOR UPDATE`;
    const c = await tx.customer.findUnique({ where: { id } });
    if (!c || c.anonymizedAt) throw new DomainError("Cliente não encontrado.");
    const appts = (await tx.appointment.findMany({ where: { customerId: id }, select: { id: true } })).map((a) => a.id);
    const sales = (await tx.sale.findMany({ where: { customerId: id }, select: { id: true } })).map((s) => s.id);

    // O nome também aparece em textos já gravados: descrição dos lançamentos e frases da auditoria.
    const related = [id, ...appts, ...sales];
    await tx.$executeRaw`UPDATE "AuditLog" SET summary = replace(summary, ${c.name}, ${REMOVED_NAME.toLowerCase()}), changes = CASE WHEN entity = 'Customer' THEN NULL ELSE changes END WHERE "entityId" IN (${Prisma.join(related)})`;

    // Retornos e anotações de contato não são contabilidade: saem por inteiro.
    await tx.followUp.deleteMany({ where: { customerId: id } });

    if (appts.length === 0 && sales.length === 0) {
      await tx.customer.delete({ where: { id } });
      await writeAudit(tx, { actorId, action: "cliente.excluir", entity: "Customer", entityId: id, summary: "Excluiu o cadastro de um cliente a pedido dele (sem histórico)" });
      return { deleted: true };
    }

    await tx.$executeRaw`UPDATE "LedgerEntry" SET description = replace(description, ${c.name}, ${REMOVED_NAME.toLowerCase()}) WHERE "appointmentId" IN (${Prisma.join(appts.length ? appts : ["-"])})`;
    await tx.appointment.updateMany({ where: { customerId: id }, data: { notes: null } });
    await tx.customer.update({ where: { id }, data: { name: REMOVED_NAME, phone: null, email: null, notes: null, anonymizedAt: new Date() } });
    await writeAudit(tx, {
      actorId,
      action: "cliente.anonimizar",
      entity: "Customer",
      entityId: id,
      summary: `Apagou os dados pessoais de um cliente a pedido dele; ${appts.length} atendimento(s) e ${sales.length} compra(s) ficam no histórico sem identificação`,
    });
    return { deleted: false };
  });
}

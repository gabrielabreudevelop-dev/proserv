/**
 * Retornos — quando voltar a falar com o cliente e qual serviço oferecer.
 *
 * - Nasce ao concluir um atendimento de serviço com retorno configurado
 *   (data = dia do atendimento + N meses; dá para ajustar ou dispensar na hora).
 * - Agendar o serviço do retorno marca o retorno como AGENDADO; concluir esse
 *   atendimento marca REALIZADO e gera o próximo.
 * - Cancelar o atendimento marcado devolve o retorno para PENDENTE.
 * - Um cliente tem no máximo um retorno aberto por serviço.
 */
import { Prisma, type FollowUpStatus } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { addDays, addMonthsISO, diffDaysISO, localParts } from "@/lib/time";
import { DomainError } from "./errors";
import { writeAudit } from "./audit";

type Tx = Prisma.TransactionClient;
const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);

export const CONTACT_CHANNELS = { WHATSAPP: "WhatsApp", LIGACAO: "Ligação", OUTRO: "Outro" } as const;
export const CONTACT_OUTCOMES = {
  SEM_RESPOSTA: "Não respondeu",
  FALAR_DEPOIS: "Pediu para falar depois",
  VAI_AGENDAR: "Vai agendar",
  NAO_QUER: "Não quer o retorno",
} as const;
export type ContactChannel = keyof typeof CONTACT_CHANNELS;
export type ContactOutcome = keyof typeof CONTACT_OUTCOMES;

/** Coluna DATE ↔ "YYYY-MM-DD". */
export const toDate = (iso: string) => new Date(`${iso}T00:00:00Z`);
export const fromDate = (d: Date) => d.toISOString().slice(0, 10);
const isISO = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

// ── Ganchos chamados pela agenda, dentro da mesma transação ──

/** Agendou: o retorno pendente daquele serviço (ou o indicado) passa a AGENDADO. */
export async function linkScheduled(tx: Tx, a: { id: string; customerId: string; serviceId: string }, followUpId?: string) {
  const f = followUpId
    ? await tx.followUp.findFirst({ where: { id: followUpId, customerId: a.customerId, status: "PENDENTE" } })
    : await tx.followUp.findFirst({ where: { customerId: a.customerId, serviceId: a.serviceId, status: "PENDENTE" }, orderBy: { dueOn: "asc" } });
  if (followUpId && !f) throw new DomainError("Este retorno não está mais pendente.");
  if (f) await tx.followUp.update({ where: { id: f.id }, data: { status: "AGENDADO", appointmentId: a.id } });
  return f?.id ?? null;
}

/**
 * Concluiu: cumpre o retorno ligado (ou pendente do mesmo serviço) e programa o próximo.
 * `next`: undefined = regra do serviço; null = sem retorno; "YYYY-MM-DD" = data escolhida.
 */
export async function onCompleted(
  tx: Tx,
  a: { id: string; customerId: string; serviceId: string; service: { returnAfterMonths: number | null; returnServiceId: string | null } },
  { day, next, actorId, now }: { day: string; next?: string | null; actorId: string; now: Date },
) {
  const fulfilled =
    (await tx.followUp.findFirst({ where: { appointmentId: a.id } })) ??
    (await tx.followUp.findFirst({ where: { customerId: a.customerId, serviceId: a.serviceId, status: "PENDENTE" }, orderBy: { dueOn: "asc" } }));
  if (fulfilled) await tx.followUp.update({ where: { id: fulfilled.id }, data: { status: "REALIZADO", appointmentId: a.id, closedAt: now } });

  if (next === null) return null;
  if (next !== undefined && (!isISO(next) || next <= day)) throw new DomainError("A data do retorno precisa ser depois do atendimento.", { followUpOn: "Data inválida" });
  const dueOn = next ?? (a.service.returnAfterMonths ? addMonthsISO(day, a.service.returnAfterMonths) : null);
  if (!dueOn) return null;

  const serviceId = a.service.returnServiceId ?? a.serviceId;
  const open = await tx.followUp.findFirst({ where: { customerId: a.customerId, serviceId, status: { in: ["PENDENTE", "AGENDADO"] } } });
  if (open?.status === "AGENDADO") return open; // o próximo já está marcado
  if (open) return tx.followUp.update({ where: { id: open.id }, data: { dueOn: toDate(dueOn), sourceAppointmentId: a.id } });
  return tx.followUp.create({ data: { customerId: a.customerId, serviceId, dueOn: toDate(dueOn), sourceAppointmentId: a.id, createdById: actorId } });
}

/** Cancelou: o retorno que ele cumpria volta a pendente; se era concluído, o retorno que ele gerou é encerrado. */
export async function onCancelled(tx: Tx, a: { id: string }, { wasCompleted, now }: { wasCompleted: boolean; now: Date }) {
  await tx.followUp.updateMany({ where: { appointmentId: a.id }, data: { status: "PENDENTE", appointmentId: null, closedAt: null } });
  if (wasCompleted) {
    await tx.followUp.updateMany({
      where: { sourceAppointmentId: a.id, status: "PENDENTE" },
      data: { status: "ENCERRADO", closedAt: now, closedReason: "O atendimento que gerou o retorno foi cancelado" },
    });
  }
}

/** Juntou cadastros: leva os retornos e deixa um aberto por serviço (o mais próximo). */
export async function mergeFollowUps(tx: Tx, sourceId: string, targetId: string, now: Date) {
  await tx.followUp.updateMany({ where: { customerId: sourceId }, data: { customerId: targetId } });
  const open = await tx.followUp.findMany({ where: { customerId: targetId, status: "PENDENTE" }, orderBy: { dueOn: "asc" } });
  const seen = new Set<string>();
  const agendados = new Set((await tx.followUp.findMany({ where: { customerId: targetId, status: "AGENDADO" }, select: { serviceId: true } })).map((f) => f.serviceId));
  for (const f of open) {
    if (seen.has(f.serviceId) || agendados.has(f.serviceId)) {
      await tx.followUp.update({ where: { id: f.id }, data: { status: "ENCERRADO", closedAt: now, closedReason: "Cadastro juntado: retorno repetido" } });
    }
    seen.add(f.serviceId);
  }
}

// ── Ações da tela de retornos ────────────────────────────

async function loadOpen(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM "FollowUp" WHERE id = ${id} FOR UPDATE`;
  const f = await tx.followUp.findUnique({ where: { id }, include: { customer: { select: { name: true } }, service: { select: { name: true } } } });
  if (!f) throw new DomainError("Retorno não encontrado.");
  return f;
}

export async function registerContact({
  id,
  channel,
  outcome,
  note,
  snoozeTo,
  actorId,
  now = new Date(),
}: {
  id: string;
  channel: ContactChannel;
  outcome: ContactOutcome;
  note?: string;
  snoozeTo?: string;
  actorId: string;
  now?: Date;
}) {
  if (!(channel in CONTACT_CHANNELS) || !(outcome in CONTACT_OUTCOMES)) throw new DomainError("Contato inválido.");
  const today = localParts(now).date;
  if (outcome === "FALAR_DEPOIS" && (!snoozeTo || !isISO(snoozeTo) || snoozeTo <= today)) {
    throw new DomainError("Escolha uma data a partir de amanhã.", { snoozeTo: "Data inválida" });
  }
  return prisma.$transaction(async (tx) => {
    const f = await loadOpen(tx, id);
    if (f.status !== "PENDENTE") throw new DomainError("Este retorno não está mais pendente.");
    await tx.followUpContact.create({ data: { followUpId: id, channel, outcome, note: note?.trim() || null, userId: actorId } });
    if (outcome === "FALAR_DEPOIS") await tx.followUp.update({ where: { id }, data: { dueOn: toDate(snoozeTo!) } });
    if (outcome === "NAO_QUER") {
      const reason = note?.trim() || CONTACT_OUTCOMES.NAO_QUER;
      await tx.followUp.update({ where: { id }, data: { status: "ENCERRADO", closedAt: now, closedReason: reason } });
      await writeAudit(tx, { actorId, action: "retorno.encerrar", entity: "Customer", entityId: f.customerId, summary: `Encerrou o retorno de ${f.service.name} de ${f.customer.name}: ${reason}` });
    }
  });
}

export async function rescheduleFollowUp({ id, dueOn, now = new Date() }: { id: string; dueOn: string; now?: Date }) {
  if (!isISO(dueOn) || dueOn < localParts(now).date) throw new DomainError("Escolha hoje ou uma data futura.", { dueOn: "Data inválida" });
  return prisma.$transaction(async (tx) => {
    const f = await loadOpen(tx, id);
    if (f.status !== "PENDENTE") throw new DomainError("Este retorno não está mais pendente.");
    await tx.followUp.update({ where: { id }, data: { dueOn: toDate(dueOn) } });
  });
}

export async function closeFollowUp({ id, reason, actorId, now = new Date() }: { id: string; reason: string; actorId: string; now?: Date }) {
  if (reason.trim().length < 3) throw new DomainError("Descreva o motivo.", { reason: "Obrigatório" });
  return prisma.$transaction(async (tx) => {
    const f = await loadOpen(tx, id);
    if (f.status !== "PENDENTE") throw new DomainError("Este retorno não está mais pendente.");
    await tx.followUp.update({ where: { id }, data: { status: "ENCERRADO", closedAt: now, closedReason: reason.trim() } });
    await writeAudit(tx, { actorId, action: "retorno.encerrar", entity: "Customer", entityId: f.customerId, summary: `Encerrou o retorno de ${f.service.name} de ${f.customer.name}: ${reason.trim()}` });
  });
}

/** Retorno programado à mão (cliente antigo, combinado por telefone...). */
export async function createFollowUp({ customerId, serviceId, dueOn, actorId, now = new Date() }: { customerId: string; serviceId: string; dueOn: string; actorId: string; now?: Date }) {
  if (!isISO(dueOn) || dueOn < localParts(now).date) throw new DomainError("Escolha hoje ou uma data futura.", { dueOn: "Data inválida" });
  return prisma.$transaction(async (tx) => {
    const c = await tx.customer.findUnique({ where: { id: customerId } });
    if (!c || c.anonymizedAt) throw new DomainError("Cliente não encontrado.");
    const s = await tx.service.findUnique({ where: { id: serviceId } });
    if (!s || !s.active) throw new DomainError("Serviço indisponível.", { serviceId: "Serviço inválido" });
    const open = await tx.followUp.findFirst({ where: { customerId, serviceId, status: { in: ["PENDENTE", "AGENDADO"] } } });
    if (open) {
      throw new DomainError(
        open.status === "AGENDADO" ? `${s.name} já está agendado para este cliente.` : `Já existe um retorno de ${s.name} para ${fromDate(open.dueOn).split("-").reverse().join("/")}.`,
        { serviceId: "Já programado" },
      );
    }
    const f = await tx.followUp.create({ data: { customerId, serviceId, dueOn: toDate(dueOn), createdById: actorId } });
    await writeAudit(tx, { actorId, action: "retorno.programar", entity: "Customer", entityId: customerId, summary: `Programou retorno de ${s.name} para ${c.name} em ${dueOn.split("-").reverse().join("/")}` });
    return f;
  });
}

// ── Consultas ────────────────────────────────────────────

export type FollowUpTab = "atrasados" | "semana" | "proximos" | "depois" | "agendados" | "historico";

export type FollowUpRow = {
  id: string;
  dueOn: string;
  status: FollowUpStatus;
  customer: { id: string; name: string; phone: string | null };
  service: { id: string; name: string; price: string };
  source: { service: string; date: string } | null;
  appointment: { startsAt: string; status: string } | null;
  lastContact: { at: string; channel: string; outcome: string; note: string | null; user: string } | null;
  contacts: number;
  closedReason: string | null;
  closedAt: string | null;
};

function windows(now: Date) {
  const today = localParts(now).date;
  return { today, week: addDays(today, 6), month: addDays(today, 30) };
}

function whereFor(tab: FollowUpTab, now: Date): Prisma.FollowUpWhereInput {
  const { today, week, month } = windows(now);
  const pending = { status: "PENDENTE" as const, customer: { anonymizedAt: null } };
  switch (tab) {
    case "atrasados":
      return { ...pending, dueOn: { lt: toDate(today) } };
    case "semana":
      return { ...pending, dueOn: { gte: toDate(today), lte: toDate(week) } };
    case "proximos":
      return { ...pending, dueOn: { gt: toDate(week), lte: toDate(month) } };
    case "depois":
      return { ...pending, dueOn: { gt: toDate(month) } };
    case "agendados":
      return { status: "AGENDADO" };
    case "historico":
      return { status: { in: ["REALIZADO", "ENCERRADO"] } };
  }
}

const TABS: FollowUpTab[] = ["atrasados", "semana", "proximos", "depois", "agendados", "historico"];

export async function listFollowUps({ tab = "atrasados", q = "", customerId, now = new Date() }: { tab?: FollowUpTab; q?: string; customerId?: string; now?: Date } = {}) {
  const search: Prisma.FollowUpWhereInput = q.trim()
    ? { OR: [{ customer: { name: { contains: q.trim(), mode: "insensitive" } } }, { service: { name: { contains: q.trim(), mode: "insensitive" } } }, ...(q.replace(/\D/g, "").length >= 3 ? [{ customer: { phone: { contains: q.replace(/\D/g, "") } } }] : [])] }
    : {};
  const scope: Prisma.FollowUpWhereInput = customerId ? { customerId } : {};

  const [rows, counts] = await Promise.all([
    prisma.followUp.findMany({
      where: { AND: [customerId ? { status: { in: ["PENDENTE", "AGENDADO"] } } : whereFor(tab, now), search, scope] },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        service: { select: { id: true, name: true, price: true } },
        sourceAppointment: { select: { startsAt: true, service: { select: { name: true } } } },
        appointment: { select: { startsAt: true, status: true } },
        contacts: { orderBy: { createdAt: "desc" }, take: 1, include: { user: { select: { name: true } } } },
        _count: { select: { contacts: true } },
      },
      orderBy: tab === "historico" && !customerId ? { closedAt: "desc" } : { dueOn: "asc" },
      take: 300,
    }),
    Promise.all(TABS.map((t) => prisma.followUp.count({ where: { AND: [whereFor(t, now), search, scope] } }))),
  ]);

  return {
    rows: rows.map<FollowUpRow>((f) => ({
      id: f.id,
      dueOn: fromDate(f.dueOn),
      status: f.status,
      customer: f.customer,
      service: { id: f.service.id, name: f.service.name, price: f.service.price.toFixed(2) },
      source: f.sourceAppointment ? { service: f.sourceAppointment.service.name, date: f.sourceAppointment.startsAt.toISOString() } : null,
      appointment: f.appointment ? { startsAt: f.appointment.startsAt.toISOString(), status: f.appointment.status } : null,
      lastContact: f.contacts[0]
        ? { at: f.contacts[0].createdAt.toISOString(), channel: f.contacts[0].channel, outcome: f.contacts[0].outcome, note: f.contacts[0].note, user: f.contacts[0].user.name }
        : null,
      contacts: f._count.contacts,
      closedReason: f.closedReason,
      closedAt: f.closedAt?.toISOString() ?? null,
    })),
    counts: Object.fromEntries(TABS.map((t, i) => [t, counts[i]])) as Record<FollowUpTab, number>,
  };
}

/** Previsibilidade: retornos pendentes até 30 dias (inclui atrasados) e o valor de tabela deles. */
export async function followUpForecast({ now = new Date() }: { now?: Date } = {}) {
  const { today, month } = windows(now);
  const rows = await prisma.followUp.findMany({
    where: { status: "PENDENTE", customer: { anonymizedAt: null }, dueOn: { lte: toDate(month) } },
    select: { dueOn: true, service: { select: { price: true } } },
  });
  const overdue = rows.filter((r) => fromDate(r.dueOn) < today).length;
  const week = rows.filter((r) => {
    const d = fromDate(r.dueOn);
    return d >= today && diffDaysISO(today, d) <= 6;
  }).length;
  return {
    total: rows.length,
    overdue,
    week,
    value: rows.reduce((s, r) => s.add(r.service.price), D(0)).toFixed(2),
  };
}

/**
 * Agenda de atendimentos.
 *
 * Ciclo: AGENDADO → EM_ANDAMENTO → CONCLUIDO, ou → CANCELADO.
 * - Um prestador não tem dois atendimentos ativos no mesmo horário: o agendamento
 *   trava o prestador (advisory lock) e só então confere sobreposição.
 * - Concluir grava, na mesma transação: RECEITA_SERVICO (valor cobrado) e, se houver,
 *   DESPESA com o custo estimado do serviço (insumos/comissão). Data contábil = início
 *   do atendimento (ou agora, se for antes).
 * - Cancelar um concluído (gerente/admin) estorna esses lançamentos.
 */
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { PAYMENT_METHODS, REVERSAL_CATEGORY, type PaymentMethod } from "@/lib/finance-shared";
import { DomainError } from "./errors";
import { writeAudit } from "./audit";
import { resolveCustomer, type CustomerRef } from "./customers";
import { formatBRL } from "@/lib/format";

type Tx = Prisma.TransactionClient;
const D = (v: string | number | Prisma.Decimal) => new Prisma.Decimal(v);
const ACTIVE = ["AGENDADO", "EM_ANDAMENTO", "CONCLUIDO"] as const;
export const SERVICE_COST_CATEGORY = "Custo de serviços";

async function lockProvider(tx: Tx, providerId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`agenda:${providerId}`}))`;
}

async function assertFree(tx: Tx, providerId: string, startsAt: Date, endsAt: Date, exceptId?: string) {
  const clash = await tx.appointment.findFirst({
    where: {
      providerId,
      status: { in: [...ACTIVE] },
      startsAt: { lt: endsAt },
      endsAt: { gt: startsAt },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    include: { customer: { select: { name: true } }, service: { select: { name: true } } },
  });
  if (clash) {
    const hh = (d: Date) => d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
    throw new DomainError(
      `Horário ocupado: ${clash.service.name} com ${clash.customer.name}, das ${hh(clash.startsAt)} às ${hh(clash.endsAt)}.`,
      { startsAt: "Choque de horário" },
    );
  }
}

async function assertProvider(tx: Tx, providerId: string) {
  const u = await tx.user.findUnique({ where: { id: providerId }, select: { role: true, banned: true } });
  if (!u || !u.role.split(",").map((r) => r.trim()).includes("prestador") || u.banned) {
    throw new DomainError("Escolha um prestador válido.", { providerId: "Prestador inválido" });
  }
}

export type { CustomerRef } from "./customers";

export type ScheduleInput = {
  serviceId: string;
  providerId: string;
  customer: CustomerRef;
  startsAt: Date;
  notes?: string;
  userId: string;
};

export async function scheduleAppointment(input: ScheduleInput) {
  return prisma.$transaction(async (tx) => {
    const service = await tx.service.findUnique({ where: { id: input.serviceId } });
    if (!service || !service.active) throw new DomainError("Serviço indisponível.", { serviceId: "Serviço inválido" });
    await assertProvider(tx, input.providerId);
    const endsAt = new Date(input.startsAt.getTime() + service.durationMin * 60_000);
    await lockProvider(tx, input.providerId);
    await assertFree(tx, input.providerId, input.startsAt, endsAt);
    const customerId = await resolveCustomer(tx, input.customer);
    return tx.appointment.create({
      data: {
        serviceId: service.id,
        providerId: input.providerId,
        customerId,
        startsAt: input.startsAt,
        endsAt,
        notes: input.notes?.trim() || null,
        createdById: input.userId,
      },
    });
  });
}

async function loadForUpdate(tx: Tx, id: string) {
  const [row] = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Appointment" WHERE id = ${id} FOR UPDATE`;
  if (!row) throw new DomainError("Atendimento não encontrado.");
  return tx.appointment.findUniqueOrThrow({ where: { id }, include: { service: true, customer: true } });
}

/** Restringe ao próprio prestador quando quem age não pode ver todas as agendas. */
function assertOwner(a: { providerId: string }, actor: { id: string; seeAll: boolean }) {
  if (!actor.seeAll && a.providerId !== actor.id) throw new DomainError("Este atendimento é de outro prestador.");
}

export async function rescheduleAppointment({ id, startsAt, providerId, actor }: { id: string; startsAt: Date; providerId?: string; actor: { id: string; seeAll: boolean } }) {
  return prisma.$transaction(async (tx) => {
    const a = await loadForUpdate(tx, id);
    assertOwner(a, actor);
    if (a.status !== "AGENDADO") throw new DomainError("Só atendimentos ainda não iniciados podem ser remarcados.");
    const target = providerId ?? a.providerId;
    if (target !== a.providerId) await assertProvider(tx, target);
    const endsAt = new Date(startsAt.getTime() + a.service.durationMin * 60_000);
    await lockProvider(tx, target);
    await assertFree(tx, target, startsAt, endsAt, id);
    return tx.appointment.update({ where: { id }, data: { startsAt, endsAt, providerId: target } });
  });
}

export async function startAppointment({ id, actor, now = new Date() }: { id: string; actor: { id: string; seeAll: boolean }; now?: Date }) {
  return prisma.$transaction(async (tx) => {
    const a = await loadForUpdate(tx, id);
    assertOwner(a, actor);
    if (a.status !== "AGENDADO") throw new DomainError("Este atendimento não está aguardando início.");
    if (a.startsAt.getTime() - now.getTime() > 60 * 60_000) throw new DomainError("Só dá para iniciar até 1 hora antes do horário marcado.");
    return tx.appointment.update({ where: { id }, data: { status: "EM_ANDAMENTO" } });
  });
}

export async function completeAppointment({
  id,
  chargedPrice,
  paymentMethod,
  actor,
  now = new Date(),
}: {
  id: string;
  chargedPrice?: string;
  paymentMethod: PaymentMethod;
  actor: { id: string; seeAll: boolean };
  now?: Date;
}) {
  if (!(paymentMethod in PAYMENT_METHODS)) throw new DomainError("Forma de pagamento inválida.");
  return prisma.$transaction(async (tx) => {
    const a = await loadForUpdate(tx, id);
    assertOwner(a, actor);
    if (a.status !== "AGENDADO" && a.status !== "EM_ANDAMENTO") throw new DomainError("Este atendimento já foi concluído ou cancelado.");
    if (a.startsAt.getTime() - now.getTime() > 60 * 60_000) throw new DomainError("Só dá para concluir a partir de 1 hora antes do horário marcado.");

    const price = D(chargedPrice ?? a.service.price).toDecimalPlaces(2);
    if (price.lt(0)) throw new DomainError("O valor cobrado não pode ser negativo.", { chargedPrice: "Não pode ser negativo" });
    const occurredAt = a.startsAt < now ? a.startsAt : now;
    const description = `${a.service.name} — ${a.customer.name}`;

    if (price.gt(0)) {
      await tx.ledgerEntry.create({
        data: { kind: "RECEITA_SERVICO", amount: price, occurredAt, description, appointmentId: a.id, createdById: actor.id },
      });
    }
    const cost = D(a.service.estimatedCost).toDecimalPlaces(2);
    if (cost.gt(0)) {
      await tx.ledgerEntry.create({
        data: { kind: "DESPESA", amount: cost.neg(), occurredAt, description: `Insumos/comissão: ${description}`, category: SERVICE_COST_CATEGORY, appointmentId: a.id, createdById: actor.id },
      });
    }
    await writeAudit(tx, {
      actorId: actor.id,
      action: "atendimento.concluir",
      entity: "Appointment",
      entityId: a.id,
      summary: `Concluiu ${description}: cobrado ${formatBRL(price.toString())} (${PAYMENT_METHODS[paymentMethod]})${price.eq(a.service.price) ? "" : ` · tabela ${formatBRL(a.service.price.toString())}`}`,
    });
    return tx.appointment.update({
      where: { id },
      data: { status: "CONCLUIDO", chargedPrice: price, paymentMethod, completedAt: now },
    });
  });
}

/**
 * Cancela. Agendado/em andamento: qualquer um com acesso ao atendimento.
 * Concluído: só quem vê todas as agendas, e os lançamentos são estornados.
 */
export async function cancelAppointment({ id, reason, actor, now = new Date() }: { id: string; reason: string; actor: { id: string; seeAll: boolean }; now?: Date }) {
  if (reason.trim().length < 3) throw new DomainError("Descreva o motivo do cancelamento.", { reason: "Obrigatório" });
  return prisma.$transaction(async (tx) => {
    const a = await loadForUpdate(tx, id);
    assertOwner(a, actor);
    if (a.status === "CANCELADO") throw new DomainError("Este atendimento já foi cancelado.");
    if (a.status === "CONCLUIDO") {
      if (!actor.seeAll) throw new DomainError("Só gerente ou administrador cancela um atendimento concluído.");
      const entries = await tx.ledgerEntry.findMany({ where: { appointmentId: id, kind: { in: ["RECEITA_SERVICO", "DESPESA"] } } });
      for (const e of entries) {
        await tx.ledgerEntry.create({
          data: {
            kind: "ESTORNO",
            amount: D(e.amount).neg(),
            occurredAt: now,
            description: `Cancelamento: ${a.service.name} — ${a.customer.name}: ${reason.trim()}`,
            category: e.kind === "RECEITA_SERVICO" ? REVERSAL_CATEGORY.receita : REVERSAL_CATEGORY.despesa,
            appointmentId: id,
            reversesId: e.id,
            createdById: actor.id,
          },
        });
      }
    }
    await writeAudit(tx, {
      actorId: actor.id,
      action: "atendimento.cancelar",
      entity: "Appointment",
      entityId: id,
      summary: `Cancelou ${a.service.name} — ${a.customer.name}${a.status === "CONCLUIDO" ? " (concluído, valores estornados)" : ""}: ${reason.trim()}`,
    });
    return tx.appointment.update({ where: { id }, data: { status: "CANCELADO", cancelledAt: now, cancelReason: reason.trim() } });
  });
}

export type AppointmentRow = {
  id: string;
  startsAt: string;
  endsAt: string;
  status: "AGENDADO" | "EM_ANDAMENTO" | "CONCLUIDO" | "CANCELADO";
  service: { id: string; name: string; durationMin: number; price: string };
  provider: { id: string; name: string };
  customer: { id: string; name: string; phone: string | null };
  chargedPrice: string | null;
  paymentMethod: string | null;
  notes: string | null;
  cancelReason: string | null;
};

export async function listAppointments({ from, to, providerId, includeCancelled = true }: { from: Date; to: Date; providerId?: string; includeCancelled?: boolean }) {
  return queryAppointments({
    startsAt: { gte: from, lt: to },
    ...(providerId ? { providerId } : {}),
    ...(includeCancelled ? {} : { status: { not: "CANCELADO" } }),
  });
}

/** Atendimentos que já deveriam ter acontecido e não foram concluídos nem cancelados. */
export async function listOverdue({ now = new Date(), providerId }: { now?: Date; providerId?: string } = {}) {
  return queryAppointments({ endsAt: { lt: now }, status: { in: ["AGENDADO", "EM_ANDAMENTO"] }, ...(providerId ? { providerId } : {}) }, 50);
}

async function queryAppointments(where: Prisma.AppointmentWhereInput, take = 1000) {
  const rows = await prisma.appointment.findMany({
    where,
    include: {
      service: { select: { id: true, name: true, durationMin: true, price: true } },
      provider: { select: { id: true, name: true } },
      customer: { select: { id: true, name: true, phone: true } },
    },
    orderBy: { startsAt: "asc" },
    take,
  });
  return rows.map<AppointmentRow>((a) => ({
    id: a.id,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    status: a.status,
    service: { ...a.service, price: a.service.price.toString() },
    provider: a.provider,
    customer: a.customer,
    chargedPrice: a.chargedPrice?.toString() ?? null,
    paymentMethod: a.paymentMethod ? (PAYMENT_METHODS[a.paymentMethod as PaymentMethod] ?? a.paymentMethod) : null,
    notes: a.notes,
    cancelReason: a.cancelReason,
  }));
}

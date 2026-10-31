"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { can } from "@/lib/auth/permissions";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/finance-shared";
import { atLocal, isISODate } from "@/lib/time";
import { cancelAppointment, completeAppointment, rescheduleAppointment, scheduleAppointment, startAppointment } from "@/server/services/appointments";
import { createService, setServiceActive, updateService } from "@/server/services/catalog";
import { prisma } from "@/lib/db";
import { decimalField, guardedAction, optionalDecimal } from "./result";

function revalidate() {
  for (const p of ["/servicos", "/agenda", "/dashboard", "/financeiro"]) revalidatePath(p);
}

// ── Catálogo ─────────────────────────────────────────────
const serviceSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome").max(80),
  description: z.string().trim().max(200).optional(),
  price: decimalField("preço"),
  estimatedCost: z.preprocess((v) => (v === "" || v == null ? "0" : v), decimalField("custo")),
  durationMin: z.coerce.number({ error: "Informe a duração" }).int("Use minutos inteiros"),
});

export async function createServiceAction(input: unknown) {
  return guardedAction({ resource: "servico", action: "gerenciar" }, serviceSchema, input, async (data) => {
    const res = await createService(data);
    revalidate();
    return res;
  });
}

export async function updateServiceAction(id: string, input: unknown) {
  return guardedAction({ resource: "servico", action: "gerenciar" }, serviceSchema, input, async (data) => {
    const res = await updateService(id, data);
    revalidate();
    return res;
  });
}

export async function setServiceActiveAction(id: string, active: boolean) {
  return guardedAction({ resource: "servico", action: "gerenciar" }, z.boolean(), active, async (v) => {
    await setServiceActive(id, v);
    revalidate();
    return undefined;
  });
}

// ── Agenda ───────────────────────────────────────────────
const when = z.object({
  date: z.string().refine(isISODate, "Data inválida"),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida"),
});

const scheduleSchema = when.extend({
  serviceId: z.string().min(1, "Escolha o serviço"),
  providerId: z.string().min(1, "Escolha o prestador"),
  customerId: z.string().optional(),
  customerName: z.string().trim().max(80).optional(),
  customerPhone: z.string().trim().max(20).optional(),
  notes: z.string().trim().max(300).optional(),
});

export async function scheduleAction(input: unknown) {
  return guardedAction({ resource: "agenda", action: "agendar" }, scheduleSchema, input, async (d, session) => {
    const customer = d.customerId ? { id: d.customerId } : { name: d.customerName ?? "", phone: d.customerPhone };
    const a = await scheduleAppointment({ serviceId: d.serviceId, providerId: d.providerId, customer, startsAt: atLocal(d.date, d.time), notes: d.notes, userId: session.user.id });
    revalidate();
    return { id: a.id };
  });
}

/** Quem age: prestador só nos próprios atendimentos; quem vê todas as agendas, em qualquer um. */
const actorOf = (session: { user: { id: string; role?: string | null } }) => ({
  id: session.user.id,
  seeAll: can(session.user.role, "agenda", "verTodas"),
});

export async function rescheduleAction(input: unknown) {
  return guardedAction(
    { resource: "agenda", action: "agendar" },
    when.extend({ id: z.string().min(1), providerId: z.string().optional() }),
    input,
    async (d, session) => {
      await rescheduleAppointment({ id: d.id, startsAt: atLocal(d.date, d.time), providerId: d.providerId, actor: actorOf(session) });
      revalidate();
      return undefined;
    },
  );
}

export async function startAppointmentAction(id: string) {
  return guardedAction({ resource: "agenda", action: "concluir" }, z.string().min(1), id, async (aid, session) => {
    await startAppointment({ id: aid, actor: actorOf(session) });
    revalidate();
    return undefined;
  });
}

export async function completeAppointmentAction(input: unknown) {
  return guardedAction(
    { resource: "agenda", action: "concluir" },
    z.object({
      id: z.string().min(1),
      chargedPrice: optionalDecimal("valor"),
      paymentMethod: z.enum(Object.keys(PAYMENT_METHODS) as [PaymentMethod, ...PaymentMethod[]], { error: "Escolha a forma de pagamento" }),
    }),
    input,
    async (d, session) => {
      const a = await completeAppointment({ ...d, actor: actorOf(session) });
      revalidate();
      return { chargedPrice: a.chargedPrice?.toString() ?? "0" };
    },
  );
}

export async function cancelAppointmentAction(input: unknown) {
  return guardedAction(
    { resource: "agenda", action: "ver" },
    z.object({ id: z.string().min(1), reason: z.string().trim().min(3, "Descreva o motivo").max(200) }),
    input,
    async (d, session) => {
      await cancelAppointment({ ...d, actor: actorOf(session) });
      revalidate();
      return undefined;
    },
  );
}

// ── Dashboard ────────────────────────────────────────────
export async function setDashboardFocusAction(focus: unknown) {
  return guardedAction({ resource: "dashboardProdutos", action: "ver" }, z.enum(["produtos", "servicos"]), focus, async (f, session) => {
    await prisma.user.update({ where: { id: session.user.id }, data: { dashboardFocus: f === "servicos" ? "SERVICOS" : "PRODUTOS" } });
    revalidatePath("/dashboard");
    return undefined;
  });
}

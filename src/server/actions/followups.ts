"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CONTACT_CHANNELS, CONTACT_OUTCOMES, closeFollowUp, createFollowUp, registerContact, rescheduleFollowUp, type ContactChannel, type ContactOutcome } from "@/server/services/followups";
import { guardedAction } from "./result";

const PERM = { resource: "cliente", action: "gerenciar" } as const;
const isoDate = z.iso.date({ error: "Data inválida" });

function revalidate() {
  for (const p of ["/retornos", "/dashboard"]) revalidatePath(p);
  revalidatePath("/clientes", "layout");
}

export async function registerContactAction(input: unknown) {
  return guardedAction(
    PERM,
    z.object({
      id: z.string().min(1),
      channel: z.enum(Object.keys(CONTACT_CHANNELS) as [ContactChannel, ...ContactChannel[]]),
      outcome: z.enum(Object.keys(CONTACT_OUTCOMES) as [ContactOutcome, ...ContactOutcome[]], { error: "Escolha o resultado" }),
      note: z.string().trim().max(300).optional(),
      snoozeTo: z.union([isoDate, z.literal("")]).optional(),
    }),
    input,
    async (d, session) => {
      await registerContact({ ...d, snoozeTo: d.snoozeTo || undefined, actorId: session.user.id });
      revalidate();
      return { outcome: d.outcome };
    },
  );
}

export async function rescheduleFollowUpAction(input: unknown) {
  return guardedAction(PERM, z.object({ id: z.string().min(1), dueOn: isoDate }), input, async (d) => {
    await rescheduleFollowUp(d);
    revalidate();
    return { dueOn: d.dueOn };
  });
}

export async function closeFollowUpAction(input: unknown) {
  return guardedAction(PERM, z.object({ id: z.string().min(1), reason: z.string().trim().min(3, "Descreva o motivo").max(200) }), input, async (d, session) => {
    await closeFollowUp({ ...d, actorId: session.user.id });
    revalidate();
    return {};
  });
}

export async function createFollowUpAction(input: unknown) {
  return guardedAction(
    PERM,
    z.object({ customerId: z.string().min(1), serviceId: z.string().min(1, "Escolha o serviço"), dueOn: isoDate }),
    input,
    async (d, session) => {
      const f = await createFollowUp({ ...d, actorId: session.user.id });
      revalidate();
      return { id: f.id };
    },
  );
}

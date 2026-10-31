"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { BUSINESS_TZ_OFFSET } from "@/lib/finance-shared";
import { isValidISODate } from "@/lib/custom-fields";
import { createExpense, reverseExpense } from "@/server/services/finance";
import { decimalField, guardedAction } from "./result";

const PERM = { resource: "financeiro", action: "lancar" } as const;

const expenseSchema = z.object({
  amount: decimalField("valor", { min: 0.01 }),
  category: z.string().trim().min(1, "Escolha a categoria").max(60),
  description: z.string().trim().min(2, "Descreva a despesa").max(200),
  date: z.string().refine(isValidISODate, "Data inválida"),
});

function revalidate() {
  revalidatePath("/financeiro");
  revalidatePath("/dashboard");
}

export async function createExpenseAction(input: unknown) {
  return guardedAction(PERM, expenseSchema, input, async (data, session) => {
    // Meio-dia em Brasília: a data escolhida nunca escorrega para o dia vizinho.
    const occurredAt = new Date(`${data.date}T12:00:00${BUSINESS_TZ_OFFSET}`);
    const entry = await createExpense({ ...data, occurredAt, userId: session.user.id });
    revalidate();
    return { id: entry.id };
  });
}

export async function reverseExpenseAction(entryId: string) {
  return guardedAction(PERM, z.string().min(1), entryId, async (id, session) => {
    await reverseExpense({ entryId: id, userId: session.user.id });
    revalidate();
    return undefined;
  });
}

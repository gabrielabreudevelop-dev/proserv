"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { formatPhone } from "@/lib/phone";
import { diff } from "@/server/services/audit";
import { createCustomer, eraseCustomer, mergeCustomers, updateCustomer } from "@/server/services/customers";
import { auditAfter, guardedAction } from "./result";

const customerSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome").max(80),
  phone: z.string().trim().max(20).optional(),
  email: z.union([z.literal(""), z.email("E-mail inválido").max(120)]).optional(),
  notes: z.string().trim().max(500).optional(),
});

function revalidate() {
  for (const p of ["/agenda", "/vendas", "/retornos"]) revalidatePath(p);
  revalidatePath("/clientes", "layout"); // lista e fichas
}

export async function createCustomerAction(input: unknown) {
  return guardedAction({ resource: "cliente", action: "gerenciar" }, customerSchema, input, async (data, session) => {
    const res = await createCustomer(data);
    await auditAfter(session, { action: "cliente.criar", entity: "Customer", entityId: res.id, summary: `Cadastrou o cliente ${data.name}` });
    revalidate();
    return res;
  });
}

export async function updateCustomerAction(id: string, input: unknown) {
  return guardedAction({ resource: "cliente", action: "gerenciar" }, customerSchema, input, async (data, session) => {
    const { before, after, warning } = await updateCustomer(id, data);
    const changes = diff(
      { Nome: before.name, Telefone: formatPhone(before.phone), "E-mail": before.email, Observações: before.notes },
      { Nome: after.name, Telefone: formatPhone(after.phone), "E-mail": after.email, Observações: after.notes },
    );
    if (Object.keys(changes).length) {
      await auditAfter(session, { action: "cliente.editar", entity: "Customer", entityId: id, summary: `Editou o cliente ${after.name}: ${Object.keys(changes).join(", ")}`, changes });
    }
    revalidate();
    return { warning };
  });
}

export async function mergeCustomersAction(input: unknown) {
  return guardedAction(
    { resource: "cliente", action: "gerenciar" },
    z.object({ sourceId: z.string().min(1), targetId: z.string().min(1, "Escolha o cadastro que fica") }),
    input,
    async (d, session) => {
      const res = await mergeCustomers({ ...d, actorId: session.user.id });
      revalidate();
      return res;
    },
  );
}

export async function eraseCustomerAction(id: string) {
  return guardedAction({ resource: "cliente", action: "gerenciar" }, z.string().min(1), id, async (cid, session) => {
    const res = await eraseCustomer({ id: cid, actorId: session.user.id });
    revalidate();
    return res;
  });
}

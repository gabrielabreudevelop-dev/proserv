"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getSession } from "@/lib/auth/guards";
import { ROLE_NAMES, type RoleName } from "@/lib/auth/permissions";
import { isAdmin } from "@/lib/nav";
import { DomainError } from "@/server/services/errors";
import { createUser, resetPassword, setBlocked, setRoles } from "@/server/services/users";
import type { ActionResult } from "./result";

/** Ações de usuário são exclusivas do administrador. */
async function adminAction<S extends z.ZodType, T>(schema: S, input: unknown, run: (data: z.output<S>, actor: { id: string; headers: Headers }) => Promise<T>): Promise<ActionResult<T>> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sua sessão expirou. Entre novamente." };
  if (!isAdmin(session.user.role)) return { ok: false, error: "Só o administrador gerencia usuários." };
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const i of parsed.error.issues) fieldErrors[i.path.join(".")] ??= i.message;
    return { ok: false, error: "Revise os campos destacados.", fieldErrors };
  }
  try {
    const data = await run(parsed.data, { id: session.user.id, headers: await headers() });
    revalidatePath("/config/usuarios");
    return { ok: true, data };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
    console.error(e);
    return { ok: false, error: "Não foi possível concluir. Tente de novo." };
  }
}

const roles = z.array(z.enum(ROLE_NAMES as [RoleName, ...RoleName[]])).min(1, "Escolha pelo menos um cargo");

export async function createUserAction(input: unknown) {
  return adminAction(
    z.object({ name: z.string().trim().min(2, "Informe o nome").max(80), email: z.email("E-mail inválido"), roles }),
    input,
    (d, actor) => createUser(d, actor),
  );
}

export async function setRolesAction(input: unknown) {
  return adminAction(z.object({ userId: z.string().min(1), roles }), input, (d, actor) => setRoles(d.userId, d.roles, actor));
}

export async function setBlockedAction(input: unknown) {
  return adminAction(z.object({ userId: z.string().min(1), blocked: z.boolean(), reason: z.string().max(200).optional() }), input, (d, actor) =>
    setBlocked(d.userId, d.blocked, d.reason, actor),
  );
}

export async function resetPasswordAction(userId: unknown) {
  return adminAction(z.string().min(1), userId, (id, actor) => resetPassword(id, actor));
}

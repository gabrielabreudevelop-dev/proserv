import "server-only";

import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "./auth";
import { can, type Action, type Resource } from "./permissions";

/** Sessão da requisição atual (memoizada por render). */
export const getSession = cache(async () => {
  return auth.api.getSession({ headers: await headers() });
});

/** Exige usuário logado; redireciona para /login caso contrário. */
export async function requireSession() {
  const session = await getSession();
  if (!session) redirect("/login");
  if (session.user.banned) redirect("/login?erro=bloqueado");
  return session;
}

/**
 * Exige permissão. Usar em layouts/páginas (redireciona) e no início de
 * toda Server Action ou Route Handler que escreve dados.
 */
export async function requirePermission<R extends Resource>(
  resource: R,
  action: Action<R>,
) {
  const session = await requireSession();
  if (!can(session.user.role, resource, action)) redirect("/sem-acesso");
  return session;
}

/** Versão para Route Handlers: retorna Response 401/403 em vez de redirecionar. */
export async function authorizeRequest<R extends Resource>(
  resource: R,
  action: Action<R>,
) {
  const session = await getSession();
  if (!session) {
    return { ok: false as const, response: Response.json({ erro: "Não autenticado" }, { status: 401 }) };
  }
  if (!can(session.user.role, resource, action)) {
    return { ok: false as const, response: Response.json({ erro: "Sem permissão" }, { status: 403 }) };
  }
  return { ok: true as const, session };
}

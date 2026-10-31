/**
 * Gestão de usuários (só administrador). Usa a API do plugin admin do Better Auth,
 * passando os cabeçalhos da sessão — o Better Auth confere a permissão de novo.
 *
 * Regras:
 * - ninguém remove o próprio cargo de admin nem bloqueia a si mesmo;
 * - o sistema nunca fica sem pelo menos um administrador ativo;
 * - bloquear encerra as sessões abertas da pessoa.
 */
import { randomInt } from "node:crypto";
import { auth } from "@/lib/auth/auth";
import { parseRoles, ROLE_LABELS, type RoleName } from "@/lib/auth/permissions";
import { prisma } from "@/lib/db";
import { writeAudit } from "./audit";
import { DomainError } from "./errors";

type Actor = { id: string; headers: Headers };

/** Senha provisória legível: sem caracteres ambíguos (0/O, 1/l/I). */
export function temporaryPassword(length = 12) {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const chars = Array.from({ length }, () => alphabet[randomInt(alphabet.length)]);
  return `${chars.slice(0, 4).join("")}-${chars.slice(4, 8).join("")}-${chars.slice(8).join("")}`;
}

const rolesText = (roles: RoleName[]) => roles.map((r) => ROLE_LABELS[r]).join(", ");

async function activeAdminsExcept(userId: string) {
  const admins = await prisma.user.findMany({
    where: { id: { not: userId }, role: { contains: "admin" }, OR: [{ banned: false }, { banned: null }] },
    select: { role: true },
  });
  return admins.filter((u) => parseRoles(u.role).includes("admin")).length;
}

export type UserRow = { id: string; name: string; email: string; roles: RoleName[]; banned: boolean; banReason: string | null; createdAt: string; lastSeen: string | null };

export async function listUsers(): Promise<UserRow[]> {
  const users = await prisma.user.findMany({
    orderBy: [{ banned: "asc" }, { name: "asc" }],
    include: { sessions: { select: { updatedAt: true }, orderBy: { updatedAt: "desc" }, take: 1 } },
  });
  return users.map((u) => ({
    id: u.id,
    name: u.name,
    email: u.email,
    roles: parseRoles(u.role),
    banned: Boolean(u.banned),
    banReason: u.banReason,
    createdAt: u.createdAt.toISOString(),
    lastSeen: u.sessions[0]?.updatedAt.toISOString() ?? null,
  }));
}

export async function createUser(input: { name: string; email: string; roles: RoleName[] }, actor: Actor) {
  if (!input.roles.length) throw new DomainError("Escolha pelo menos um cargo.", { roles: "Obrigatório" });
  const email = input.email.trim().toLowerCase();
  if (await prisma.user.findUnique({ where: { email } })) throw new DomainError("Já existe um usuário com este e-mail.", { email: "E-mail já cadastrado" });
  const password = temporaryPassword();
  const { user } = await auth.api.createUser({
    body: { email, password, name: input.name.trim(), role: input.roles },
    headers: actor.headers,
  });
  await prisma.user.update({ where: { id: user.id }, data: { emailVerified: true } });
  await writeAudit(prisma, { actorId: actor.id, action: "usuario.criar", entity: "User", entityId: user.id, summary: `Criou o usuário ${input.name.trim()} (${email}) com cargo ${rolesText(input.roles)}` });
  return { id: user.id, password };
}

export async function setRoles(userId: string, roles: RoleName[], actor: Actor) {
  if (!roles.length) throw new DomainError("Escolha pelo menos um cargo.", { roles: "Obrigatório" });
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) throw new DomainError("Usuário não encontrado.");
  const before = parseRoles(target.role);
  const losingAdmin = before.includes("admin") && !roles.includes("admin");
  if (losingAdmin && userId === actor.id) throw new DomainError("Você não pode remover o seu próprio cargo de administrador.");
  if (losingAdmin && (await activeAdminsExcept(userId)) === 0) throw new DomainError("O sistema precisa de pelo menos um administrador ativo.");
  await auth.api.setRole({ body: { userId, role: roles }, headers: actor.headers });
  await writeAudit(prisma, {
    actorId: actor.id,
    action: "usuario.cargos",
    entity: "User",
    entityId: userId,
    summary: `Alterou os cargos de ${target.name}`,
    changes: { Cargos: [rolesText(before), rolesText(roles)] },
  });
}

export async function setBlocked(userId: string, blocked: boolean, reason: string | undefined, actor: Actor) {
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) throw new DomainError("Usuário não encontrado.");
  if (blocked) {
    if (userId === actor.id) throw new DomainError("Você não pode bloquear a si mesmo.");
    if (parseRoles(target.role).includes("admin") && (await activeAdminsExcept(userId)) === 0) {
      throw new DomainError("O sistema precisa de pelo menos um administrador ativo.");
    }
    await auth.api.banUser({ body: { userId, banReason: reason?.trim() || "Acesso bloqueado pelo administrador" }, headers: actor.headers });
    await auth.api.revokeUserSessions({ body: { userId }, headers: actor.headers });
  } else {
    await auth.api.unbanUser({ body: { userId }, headers: actor.headers });
  }
  await writeAudit(prisma, {
    actorId: actor.id,
    action: blocked ? "usuario.bloquear" : "usuario.desbloquear",
    entity: "User",
    entityId: userId,
    summary: `${blocked ? "Bloqueou" : "Desbloqueou"} o acesso de ${target.name}${blocked && reason?.trim() ? `: ${reason.trim()}` : ""}`,
  });
}

export async function resetPassword(userId: string, actor: Actor) {
  const target = await prisma.user.findUnique({ where: { id: userId } });
  if (!target) throw new DomainError("Usuário não encontrado.");
  const password = temporaryPassword();
  await auth.api.setUserPassword({ body: { userId, newPassword: password }, headers: actor.headers });
  // Senha nova derruba as sessões abertas (alguém pode estar usando a antiga).
  if (userId !== actor.id) await auth.api.revokeUserSessions({ body: { userId }, headers: actor.headers });
  await writeAudit(prisma, { actorId: actor.id, action: "usuario.senha", entity: "User", entityId: userId, summary: `Gerou uma senha provisória para ${target.name}` });
  return { password };
}

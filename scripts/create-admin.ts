/**
 * Cria (ou recupera o acesso de) um administrador. Necessário no primeiro deploy,
 * já que não existe cadastro público.
 *
 *   npm run create-admin -- --email dono@empresa.com.br --name "Nome do Dono"
 *   npm run create-admin -- --email dono@empresa.com.br --reset     # gera nova senha
 *
 * Imprime uma senha provisória uma única vez. Troque em "Minha conta" depois de entrar.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { prisma } from "../src/lib/db";
import { auth } from "../src/lib/auth/auth";
import { parseRoles } from "../src/lib/auth/permissions";
import { temporaryPassword } from "../src/server/services/users";
import { writeAudit } from "../src/server/services/audit";

async function main() {
  const { values } = parseArgs({
    options: { email: { type: "string" }, name: { type: "string" }, reset: { type: "boolean", default: false } },
  });
  const email = values.email?.trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error("Informe --email válido.");

  const ctx = await auth.$context;
  const password = temporaryPassword();
  const hash = await ctx.password.hash(password);
  const existing = await prisma.user.findUnique({ where: { email }, include: { accounts: true } });

  if (existing) {
    if (!values.reset) throw new Error(`Já existe um usuário com ${email}. Use --reset para gerar uma nova senha.`);
    const roles = parseRoles(existing.role);
    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: existing.id }, data: { role: [...new Set(["admin", ...roles])].join(","), banned: false, banReason: null } });
      const credential = existing.accounts.find((a) => a.providerId === "credential");
      if (credential) await tx.account.update({ where: { id: credential.id }, data: { password: hash } });
      else await tx.account.create({ data: { id: crypto.randomUUID(), accountId: existing.id, providerId: "credential", userId: existing.id, password: hash } });
      await tx.session.deleteMany({ where: { userId: existing.id } });
      await writeAudit(tx, { actorId: null, action: "usuario.senha", entity: "User", entityId: existing.id, summary: `Acesso de administrador recuperado pela linha de comando para ${existing.name}` });
    });
    console.log(`\nAcesso de administrador recuperado para ${existing.name} <${email}>.`);
  } else {
    const name = values.name?.trim();
    if (!name) throw new Error("Informe --name para criar um novo administrador.");
    const id = crypto.randomUUID();
    await prisma.$transaction(async (tx) => {
      await tx.user.create({
        data: { id, name, email, emailVerified: true, role: "admin", accounts: { create: { id: crypto.randomUUID(), accountId: id, providerId: "credential", password: hash } } },
      });
      await writeAudit(tx, { actorId: null, action: "usuario.criar", entity: "User", entityId: id, summary: `Administrador ${name} (${email}) criado pela linha de comando` });
    });
    console.log(`\nAdministrador criado: ${name} <${email}>.`);
  }
  console.log(`Senha provisória: ${password}\nEla não será mostrada de novo. Troque em "Minha conta" após entrar.\n`);
}

main()
  .catch((e) => {
    console.error(`Erro: ${e instanceof Error ? e.message : e}`);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

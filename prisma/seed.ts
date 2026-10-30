/**
 * Seed de desenvolvimento: um usuário por cargo + dados de exemplo.
 * Rodar com: npx prisma db seed
 *
 * Senha de todos os usuários: SEED_PASSWORD (padrão "proserv123").
 * Nunca rode em produção.
 */
import "dotenv/config";
import { prisma } from "../src/lib/db";
import { auth } from "../src/lib/auth/auth";

const PASSWORD = process.env.SEED_PASSWORD ?? "proserv123";

const USERS = [
  { name: "Ana Administradora", email: "admin@proserv.local", role: "admin" },
  { name: "Gustavo Gerente", email: "gerente@proserv.local", role: "gerente" },
  { name: "Vera Vendedora", email: "vendedor@proserv.local", role: "vendedor" },
  { name: "Paulo Prestador", email: "prestador@proserv.local", role: "prestador" },
] as const;

async function upsertUser(u: (typeof USERS)[number], passwordHash: string) {
  const existing = await prisma.user.findUnique({ where: { email: u.email } });
  if (existing) {
    await prisma.user.update({ where: { id: existing.id }, data: { role: u.role, name: u.name } });
    return existing.id;
  }
  const id = crypto.randomUUID();
  await prisma.user.create({
    data: {
      id,
      name: u.name,
      email: u.email,
      emailVerified: true,
      role: u.role,
      accounts: {
        create: {
          id: crypto.randomUUID(),
          accountId: id,
          providerId: "credential",
          password: passwordHash,
        },
      },
    },
  });
  return id;
}

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("Seed não deve rodar em produção.");

  const ctx = await auth.$context;
  const passwordHash = await ctx.password.hash(PASSWORD);
  for (const u of USERS) await upsertUser(u, passwordHash);

  // Catálogo de exemplo
  const [bebidas, limpeza] = await Promise.all([
    prisma.category.upsert({ where: { name: "Bebidas" }, update: {}, create: { name: "Bebidas" } }),
    prisma.category.upsert({ where: { name: "Limpeza" }, update: {}, create: { name: "Limpeza" } }),
  ]);

  await prisma.customFieldDefinition.upsert({
    where: { entity_key: { entity: "product", key: "vencimento" } },
    update: {},
    create: { key: "vencimento", label: "Vencimento", type: "DATE", visibleByDefault: true, position: 0 },
  });
  await prisma.customFieldDefinition.upsert({
    where: { entity_key: { entity: "product", key: "lote" } },
    update: {},
    create: { key: "lote", label: "Lote", type: "TEXT", visibleByDefault: false, position: 1 },
  });

  const products = [
    { sku: "BEB-001", name: "Água mineral 500 ml", categoryId: bebidas.id, salePrice: "3.50", avgCost: "1.20", stockQty: "120", minStock: "24", customFields: { vencimento: "2027-06-30", lote: "A1" } },
    { sku: "BEB-002", name: "Refrigerante lata 350 ml", categoryId: bebidas.id, salePrice: "6.00", avgCost: "2.90", stockQty: "60", minStock: "12", customFields: { vencimento: "2027-02-15", lote: "R7" } },
    { sku: "LIM-001", name: "Detergente neutro 500 ml", categoryId: limpeza.id, salePrice: "4.90", avgCost: "2.10", stockQty: "8", minStock: "10", customFields: { lote: "D3" } },
  ];
  for (const p of products) {
    await prisma.product.upsert({ where: { sku: p.sku }, update: {}, create: p });
  }

  const services = [
    { name: "Instalação de ar-condicionado", description: "Split até 12.000 BTUs", price: "350.00", estimatedCost: "80.00", durationMin: 120 },
    { name: "Limpeza de ar-condicionado", description: "Higienização completa", price: "180.00", estimatedCost: "30.00", durationMin: 60 },
  ];
  if ((await prisma.service.count()) === 0) await prisma.service.createMany({ data: services });

  console.log(`Seed concluído. Usuários: ${USERS.map((u) => u.email).join(", ")} · senha: ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

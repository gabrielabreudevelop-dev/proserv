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
import { createProduct } from "../src/server/services/products";

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

  // Campos personalizados de exemplo (o mesmo que a pessoa faria em /produtos/campos)
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

  // Catálogo: [sku, nome, categoria, preço, qtd inicial, custo un., mínimo, vencimento, lote]
  const catalog: [string, string, string, string, string, string, string | null, string | null, string | null][] = [
    ["BEB-001", "Água mineral 500 ml", "Bebidas", "3.50", "120", "1.20", "24", "2027-06-30", "A1"],
    ["BEB-002", "Refrigerante lata 350 ml", "Bebidas", "6.00", "60", "2.90", "12", "2027-02-15", "R7"],
    ["BEB-003", "Suco de uva integral 1 L", "Bebidas", "14.90", "18", "8.40", "6", "2026-12-10", "U2"],
    ["BEB-004", "Café torrado 500 g", "Bebidas", "24.90", "4", "15.80", "8", "2027-04-01", "C9"],
    ["BEB-005", "Chá mate 1,5 L", "Bebidas", "8.50", "30", "4.10", "10", "2027-01-20", "M3"],
    ["LIM-001", "Detergente neutro 500 ml", "Limpeza", "4.90", "8", "2.10", "10", null, "D3"],
    ["LIM-002", "Desinfetante lavanda 2 L", "Limpeza", "12.90", "25", "6.30", "8", null, "L5"],
    ["LIM-003", "Esponja dupla face (pct 4)", "Limpeza", "7.90", "40", "3.20", "12", null, null],
    ["LIM-004", "Sabão em pó 1 kg", "Limpeza", "18.50", "0", "0", "6", null, null],
    ["LIM-005", "Água sanitária 1 L", "Limpeza", "5.40", "36", "2.50", "12", "2027-08-30", "S1"],
    ["HIG-001", "Papel higiênico (pct 12)", "Higiene", "22.90", "20", "13.90", "6", null, null],
    ["HIG-002", "Sabonete em barra 90 g", "Higiene", "2.99", "90", "1.10", "30", "2028-01-15", "B4"],
    ["HIG-003", "Creme dental 90 g", "Higiene", "6.49", "45", "2.80", "15", "2027-11-30", "T2"],
    ["HIG-004", "Shampoo 350 ml", "Higiene", "16.90", "12", "8.90", "5", "2027-09-12", "SH1"],
    ["MER-001", "Arroz branco 5 kg", "Mercearia", "29.90", "15", "21.50", "5", "2027-05-05", "AR8"],
    ["MER-002", "Feijão carioca 1 kg", "Mercearia", "8.99", "28", "5.90", "10", "2027-03-18", "FJ2"],
    ["MER-003", "Óleo de soja 900 ml", "Mercearia", "7.49", "6", "5.20", "10", "2027-07-22", "OL1"],
    ["MER-004", "Açúcar refinado 1 kg", "Mercearia", "4.99", "50", "3.10", "15", "2028-02-28", "AC3"],
    ["MER-005", "Macarrão espaguete 500 g", "Mercearia", "4.59", "60", "2.30", "20", "2027-10-10", "MC5"],
    ["MER-006", "Biscoito recheado 140 g", "Mercearia", "3.29", "3", "3.60", "12", "2026-11-25", "BR7"],
    ["UTI-001", "Pilha AA (cartela 4)", "Utilidades", "19.90", "14", "9.50", "4", null, null],
    ["UTI-002", "Lâmpada LED 9 W", "Utilidades", "12.90", "22", "5.70", "6", null, null],
    ["UTI-003", "Fita isolante 10 m", "Utilidades", "6.90", "16", "2.40", "5", null, null],
    ["UTI-004", "Extensão 3 tomadas 2 m", "Utilidades", "34.90", "7", "17.80", "3", null, null],
  ];

  const admin = await prisma.user.findUniqueOrThrow({ where: { email: "admin@proserv.local" } });
  let created = 0;
  for (const [sku, name, category, salePrice, qty, cost, min, venc, lote] of catalog) {
    if (await prisma.product.findUnique({ where: { sku } })) continue;
    const customFields: Record<string, string> = {};
    if (venc) customFields.vencimento = venc;
    if (lote) customFields.lote = lote;
    await createProduct(
      { sku, name, category, salePrice, minStock: min ?? undefined, customFields, initialQty: qty, initialCost: cost },
      admin.id,
    );
    created++;
  }

  const services = [
    { name: "Instalação de ar-condicionado", description: "Split até 12.000 BTUs", price: "350.00", estimatedCost: "80.00", durationMin: 120 },
    { name: "Limpeza de ar-condicionado", description: "Higienização completa", price: "180.00", estimatedCost: "30.00", durationMin: 60 },
  ];
  if ((await prisma.service.count()) === 0) await prisma.service.createMany({ data: services });

  console.log(`Seed concluído. ${created} produtos novos. Usuários: ${USERS.map((u) => u.email).join(", ")} · senha: ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

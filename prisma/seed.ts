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
import { createSale, cancelSale } from "../src/server/services/sales";
import { createExpense } from "../src/server/services/finance";
import { scheduleAppointment, completeAppointment, cancelAppointment, startAppointment } from "../src/server/services/appointments";
import { addDays, atLocal, localParts } from "../src/lib/time";
import { currentMonth, shiftMonth, BUSINESS_TZ_OFFSET, type PaymentMethod } from "../src/lib/finance-shared";

const PASSWORD = process.env.SEED_PASSWORD ?? "proserv123";

const USERS = [
  { name: "Ana Administradora", email: "admin@proserv.local", role: "admin" },
  { name: "Gustavo Gerente", email: "gerente@proserv.local", role: "gerente" },
  { name: "Vera Vendedora", email: "vendedor@proserv.local", role: "vendedor" },
  { name: "Paulo Prestador", email: "prestador@proserv.local", role: "prestador" },
  { name: "Marina Técnica", email: "prestador2@proserv.local", role: "prestador" },
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

  // Vendas e despesas de exemplo (mês anterior + mês atual até hoje), só se ainda não houver vendas.
  if ((await prisma.sale.count()) === 0) {
    const vendedor = await prisma.user.findUniqueOrThrow({ where: { email: "vendedor@proserv.local" } });
    const bySku = new Map((await prisma.product.findMany({ select: { id: true, sku: true } })).map((p) => [p.sku, p.id]));
    const methods: PaymentMethod[] = ["PIX", "PIX", "DEBITO", "CREDITO", "DINHEIRO"];
    const now = new Date();
    const at = (month: string, day: number, hour: number) => new Date(`${month}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:15:00${BUSINESS_TZ_OFFSET}`);
    // [dia, hora, vendedor?, itens [sku, qtd], desconto]
    const plan: [number, number, boolean, [string, number][], string][] = [
      [2, 9, true, [["BEB-001", 6], ["MER-005", 2]], "0"],
      [3, 11, false, [["MER-001", 1], ["MER-002", 2], ["MER-004", 2]], "2"],
      [5, 15, true, [["HIG-002", 4], ["HIG-003", 2]], "0"],
      [8, 10, true, [["LIM-002", 1], ["LIM-003", 2], ["LIM-005", 2]], "0"],
      [9, 17, false, [["UTI-002", 2], ["UTI-001", 1]], "3"],
      [12, 12, true, [["BEB-002", 6], ["BEB-005", 2]], "0"],
      [15, 9, true, [["HIG-001", 1], ["HIG-004", 1]], "0"],
      [18, 16, false, [["MER-001", 1], ["BEB-003", 1]], "0"],
      [21, 14, true, [["BEB-001", 12]], "4"],
      [24, 11, true, [["UTI-003", 2], ["UTI-002", 1]], "0"],
      [27, 18, false, [["MER-002", 3], ["MER-005", 3]], "0"],
    ];
    const months = [shiftMonth(currentMonth(), -1), currentMonth()];
    let n = 0;
    for (const month of months) {
      for (const [i, [day, hour, byVendedor, items, discount]] of plan.entries()) {
        const when = at(month, day, hour);
        if (when > now) continue;
        const { sale } = await createSale({
          items: items.map(([sku, q]) => ({ productId: bySku.get(sku)!, quantity: String(q) })),
          discount,
          paymentMethod: methods[i % methods.length],
          sellerId: byVendedor ? vendedor.id : admin.id,
          at: when,
        });
        n++;
        if (month === months[0] && i === 4) {
          await cancelSale({ saleId: sale.id, userId: admin.id, reason: "Cliente devolveu na mesma hora", at: new Date(when.getTime() + 20 * 60_000) });
        }
      }
      for (const [day, category, description, amount] of [
        [5, "Aluguel", "Aluguel do quiosque", "120.00"],
        [10, "Energia", "Conta de luz", "38.40"],
        [10, "Internet e telefone", "Internet fibra", "29.90"],
      ] as const) {
        const when = at(month, day, 12);
        if (when <= now) await createExpense({ amount, category, description, occurredAt: when, userId: admin.id });
      }
    }
    console.log(`${n} vendas de exemplo criadas.`);
  }

  // Catálogo de serviços
  const services: [string, string, string, string, number][] = [
    ["Instalação de ar-condicionado", "Split até 12.000 BTUs", "350.00", "80.00", 120],
    ["Limpeza de ar-condicionado", "Higienização completa", "180.00", "30.00", 60],
    ["Manutenção preventiva", "Revisão e teste de gás", "220.00", "45.00", 90],
    ["Visita técnica", "Diagnóstico no local", "90.00", "0", 30],
    ["Troca de capacitor", "Peça inclusa", "160.00", "55.00", 45],
  ];
  for (const [name, description, price, estimatedCost, durationMin] of services) {
    const found = await prisma.service.findFirst({ where: { name } });
    if (found) await prisma.service.update({ where: { id: found.id }, data: { description, price, estimatedCost, durationMin } });
    else await prisma.service.create({ data: { name, description, price, estimatedCost, durationMin } });
  }

  // Agenda de exemplo: últimos 10 dias, hoje e próximos 6 dias (só se ainda não houver atendimentos)
  if ((await prisma.appointment.count()) === 0) {
    const svc = new Map((await prisma.service.findMany()).map((x) => [x.name, x.id]));
    const paulo = await prisma.user.findUniqueOrThrow({ where: { email: "prestador@proserv.local" } });
    const marina = await prisma.user.findUniqueOrThrow({ where: { email: "prestador2@proserv.local" } });
    const clientes = ["Ana Souza", "Bruno Lima", "Carla Mendes", "Diego Rocha", "Elaine Costa", "Fábio Nunes", "Gisele Prado", "Hugo Alves", "Isabela Reis", "João Pedro Martins"];
    const now = new Date();
    const today = localParts(now).date;
    const names = [...svc.keys()];
    // [deslocamento em dias, hora, prestador, índice do serviço]
    const slots: [number, string, "p" | "m", number][] = [];
    for (let d = -10; d <= 6; d++) {
      slots.push([d, "08:00", "p", (d + 20) % 5], [d, "13:30", "p", (d + 21) % 5], [d, "09:30", "m", (d + 22) % 5]);
      if (d % 2 === 0) slots.push([d, "15:00", "m", (d + 23) % 5]);
    }
    let created = 0;
    for (const [i, [d, time, who, si]] of slots.entries()) {
      const date = addDays(today, d);
      const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
      if (weekday === 0) continue; // domingo fechado
      const providerId = who === "p" ? paulo.id : marina.id;
      const actor = { id: providerId, seeAll: false };
      const a = await scheduleAppointment({
        serviceId: svc.get(names[si])!,
        providerId,
        customer: { name: clientes[i % clientes.length], phone: `1199${String(1000000 + (i % clientes.length) * 7919).slice(-7)}` },
        startsAt: atLocal(date, time),
        userId: admin.id,
      });
      created++;
      const end = a.endsAt;
      if (end < now) {
        if (i % 11 === 5) await cancelAppointment({ id: a.id, reason: "Cliente não estava em casa", actor, now: a.startsAt });
        else if (i % 13 === 7) {
          /* fica pendente: horário passou e ninguém concluiu */
        } else await completeAppointment({ id: a.id, paymentMethod: (["PIX", "DINHEIRO", "CREDITO"] as const)[i % 3], actor, now: end });
      } else if (a.startsAt < now) {
        await startAppointment({ id: a.id, actor, now });
      }
    }
    console.log(`${created} atendimentos de exemplo criados.`);
  }

  console.log(`Seed concluído. ${created} produtos novos. Usuários: ${USERS.map((u) => u.email).join(", ")} · senha: ${PASSWORD}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());

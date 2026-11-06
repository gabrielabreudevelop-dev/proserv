import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { atLocal } from "@/lib/time";
import { cancelAppointment, completeAppointment, scheduleAppointment } from "./appointments";
import { createSale } from "./sales";
import { createCustomer, eraseCustomer, getCustomerDetail, listCustomerSummaries, mergeCustomers, REMOVED_NAME, updateCustomer } from "./customers";

const RUN = `C${Date.now().toString(36).toUpperCase()}`;
let prov: string, mgr: string, svc: string, svc2: string, product: string;
const actor = () => ({ id: mgr, seeAll: true });
const NOW = atLocal("2025-04-30", "12:00");

beforeAll(async () => {
  prov = (await prisma.user.create({ data: { id: `${RUN}-p`, name: `Prest ${RUN}`, email: `p-${RUN}@proserv.test`, role: "prestador" } })).id;
  mgr = (await prisma.user.create({ data: { id: `${RUN}-g`, name: `Ger ${RUN}`, email: `g-${RUN}@proserv.test`, role: "gerente" } })).id;
  svc = (await prisma.service.create({ data: { name: `Corte ${RUN}`, price: "50", estimatedCost: "0", durationMin: 30 } })).id;
  svc2 = (await prisma.service.create({ data: { name: `Barba ${RUN}`, price: "30", estimatedCost: "0", durationMin: 30 } })).id;
  product = (await prisma.product.create({ data: { sku: `${RUN}-P`, name: `Pomada ${RUN}`, salePrice: "25", avgCost: "10", stockQty: "100" } })).id;
});

afterAll(async () => {
  const customers = (await prisma.customer.findMany({ where: { OR: [{ name: { contains: RUN } }, { appointments: { some: { serviceId: { in: [svc, svc2] } } } }] }, select: { id: true } })).map((c) => c.id);
  const appts = (await prisma.appointment.findMany({ where: { serviceId: { in: [svc, svc2] } }, select: { id: true } })).map((a) => a.id);
  const sales = (await prisma.sale.findMany({ where: { sellerId: mgr }, select: { id: true } })).map((s) => s.id);
  await prisma.ledgerEntry.deleteMany({ where: { OR: [{ appointmentId: { in: appts } }, { saleId: { in: sales } }], reversesId: { not: null } } });
  await prisma.ledgerEntry.deleteMany({ where: { OR: [{ appointmentId: { in: appts } }, { saleId: { in: sales } }] } });
  await prisma.stockMovement.deleteMany({ where: { productId: product } });
  await prisma.saleItem.deleteMany({ where: { saleId: { in: sales } } });
  await prisma.sale.deleteMany({ where: { id: { in: sales } } });
  await prisma.appointment.deleteMany({ where: { id: { in: appts } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: [mgr, prov] } } });
  await prisma.customer.deleteMany({ where: { id: { in: customers } } });
  await prisma.product.deleteMany({ where: { id: product } });
  await prisma.service.deleteMany({ where: { id: { in: [svc, svc2] } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: RUN } } });
  await prisma.$disconnect();
});

async function visit(customerId: string, date: string, time: string, serviceId = svc, price?: string) {
  const a = await scheduleAppointment({ serviceId, providerId: prov, customer: { id: customerId }, startsAt: atLocal(date, time), notes: "Rua das Flores, 10", userId: mgr });
  await completeAppointment({ id: a.id, chargedPrice: price, paymentMethod: "PIX", actor: actor(), now: atLocal(date, time) });
  return a.id;
}

describe("clientes (integração com Postgres)", () => {
  let ana: string;

  it("cadastra com telefone normalizado e bloqueia duplicado de nome + telefone", async () => {
    const res = await createCustomer({ name: `Ana ${RUN}`, phone: "(11) 99876-5432", notes: "Prefere manhã" });
    ana = res.id;
    expect((await prisma.customer.findUniqueOrThrow({ where: { id: ana } })).phone).toBe("11998765432");
    await expect(createCustomer({ name: `ana ${RUN}`, phone: "11 99876 5432" })).rejects.toThrow(/Já existe/);
    // Mesmo telefone, outro nome: entra com aviso (família divide número).
    const filho = await createCustomer({ name: `Pedro ${RUN}`, phone: "11998765432" });
    expect(filho.warning).toMatch(/também está no cadastro/);
    await expect(createCustomer({ name: `X ${RUN}`, phone: "123" })).rejects.toThrow(/Telefone inválido/);
  });

  it("ficha soma visitas, ticket médio, frequência, serviço preferido e compras", async () => {
    await visit(ana, "2025-02-03", "09:00"); // 50
    await visit(ana, "2025-02-17", "09:00", svc, "60"); // cobrado 60
    await visit(ana, "2025-03-03", "09:00", svc2); // 30
    const cancelled = await scheduleAppointment({ serviceId: svc, providerId: prov, customer: { id: ana }, startsAt: atLocal("2025-03-10", "09:00"), userId: mgr });
    await cancelAppointment({ id: cancelled.id, reason: "Não pôde vir", actor: actor(), now: atLocal("2025-03-09", "09:00") });
    await scheduleAppointment({ serviceId: svc, providerId: prov, customer: { id: ana }, startsAt: atLocal("2025-05-05", "09:00"), userId: mgr });
    await createSale({ items: [{ productId: product, quantity: "2" }], paymentMethod: "DINHEIRO", sellerId: mgr, customer: { id: ana }, at: atLocal("2025-03-03", "10:00") });

    const d = (await getCustomerDetail(ana, { now: NOW }))!;
    expect(d.stats.visits).toBe(3);
    expect(d.stats.servicesTotal).toBe("140.00");
    expect(d.stats.avgTicket).toBe("46.67");
    expect(d.stats.avgIntervalDays).toBe(14); // 03/02 → 17/02 → 03/03
    expect(d.stats.cancelled).toBe(1);
    expect(d.stats.favoriteService).toEqual({ name: `Corte ${RUN}`, count: 2, id: svc });
    expect(d.createdAt).toBe(atLocal("2025-02-03", "09:00").toISOString()); // primeiro atendimento, antes do cadastro
    expect(d.stats.purchases).toBe(1);
    expect(d.stats.productsTotal).toBe("50.00");
    expect(d.stats.nextAppointment).toBe(atLocal("2025-05-05", "09:00").toISOString());
    expect(d.sales[0].items).toBe(`2× Pomada ${RUN}`);
  });

  it("lista com filtros: agendados, sumidos e busca por telefone", async () => {
    const sumido = await createCustomer({ name: `Bia ${RUN}`, phone: "21987654321" });
    await visit(sumido.id, "2025-01-06", "09:00");

    const { customers } = await listCustomerSummaries({ q: RUN, now: NOW });
    const row = customers.find((c) => c.id === ana)!;
    expect(row).toMatchObject({ visits: 3, cancelled: 1, servicesTotal: "140.00", purchases: 1, productsTotal: "50.00" });
    expect(row.lastActivity).toBe(atLocal("2025-03-03", "10:00").toISOString()); // a compra foi depois da visita

    const agendados = await listCustomerSummaries({ q: RUN, filter: "agendados", now: NOW });
    expect(agendados.customers.map((c) => c.id)).toEqual([ana]);
    const sumidos = await listCustomerSummaries({ q: RUN, filter: "sumidos", now: NOW });
    expect(sumidos.customers.map((c) => c.id)).toEqual([sumido.id]);
    const porTelefone = await listCustomerSummaries({ q: "98765-4321", now: NOW });
    expect(porTelefone.customers.map((c) => c.id)).toEqual([sumido.id]);
    const porGasto = await listCustomerSummaries({ q: RUN, sort: "gasto", now: NOW });
    expect(porGasto.customers[0].id).toBe(ana);
  });

  it("edição não deixa virar duplicado", async () => {
    const bia = (await listCustomerSummaries({ q: `Bia ${RUN}` })).customers[0];
    await expect(updateCustomer(bia.id, { name: `Ana ${RUN}`, phone: "11998765432" })).rejects.toThrow(/Já existe/);
    const res = await updateCustomer(bia.id, { name: `Beatriz ${RUN}`, phone: "21987654321", email: " BIA@EXEMPLO.COM " });
    expect(res.after.email).toBe("bia@exemplo.com");
  });

  it("juntar move atendimentos e compras e apaga o cadastro repetido", async () => {
    const dup = await createCustomer({ name: `Ana S ${RUN}`, notes: "Alérgica a perfume" });
    await visit(dup.id, "2025-03-17", "09:00");
    await createSale({ items: [{ productId: product, quantity: "1" }], paymentMethod: "PIX", sellerId: mgr, customer: { id: dup.id }, at: atLocal("2025-03-17", "10:00") });

    const res = await mergeCustomers({ sourceId: dup.id, targetId: ana, actorId: mgr });
    expect(res).toMatchObject({ appointments: 1, sales: 1 });
    expect(await prisma.customer.findUnique({ where: { id: dup.id } })).toBeNull();
    const d = (await getCustomerDetail(ana, { now: NOW }))!;
    expect(d.stats.visits).toBe(4);
    expect(d.stats.purchases).toBe(2);
    expect(d.notes).toBe("Prefere manhã\nAlérgica a perfume");
    await expect(mergeCustomers({ sourceId: ana, targetId: ana, actorId: mgr })).rejects.toThrow(/outro cadastro/);
  });

  it("excluir dados (LGPD) apaga o que identifica e mantém os valores", async () => {
    const before = await prisma.ledgerEntry.aggregate({ where: { description: { contains: `Ana ${RUN}` } }, _sum: { amount: true } });
    expect(Number(before._sum.amount)).toBeGreaterThan(0);

    const res = await eraseCustomer({ id: ana, actorId: mgr });
    expect(res.deleted).toBe(false);
    const c = await prisma.customer.findUniqueOrThrow({ where: { id: ana } });
    expect(c).toMatchObject({ name: REMOVED_NAME, phone: null, email: null, notes: null });
    expect(await prisma.appointment.count({ where: { customerId: ana, notes: { not: null } } })).toBe(0);
    expect(await prisma.ledgerEntry.count({ where: { description: { contains: `Ana ${RUN}` } } })).toBe(0);
    expect(await prisma.auditLog.count({ where: { summary: { contains: `Ana ${RUN}` } } })).toBe(0);
    // Valores intactos.
    const d = (await getCustomerDetail(ana, { now: NOW }))!;
    expect(d.anonymized).toBe(true);
    expect(d.stats.visits).toBe(4);
    // Some da lista e não pode mais ser escolhido.
    expect((await listCustomerSummaries({ q: REMOVED_NAME })).customers.find((x) => x.id === ana)).toBeUndefined();
    await expect(scheduleAppointment({ serviceId: svc, providerId: prov, customer: { id: ana }, startsAt: atLocal("2025-05-20", "09:00"), userId: mgr })).rejects.toThrow(/não encontrado/);
  });

  it("cliente sem histórico é apagado de vez", async () => {
    const x = await createCustomer({ name: `Zé ${RUN}` });
    expect((await eraseCustomer({ id: x.id, actorId: mgr })).deleted).toBe(true);
    expect(await prisma.customer.findUnique({ where: { id: x.id } })).toBeNull();
  });
});

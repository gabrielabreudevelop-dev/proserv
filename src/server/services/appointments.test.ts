import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { monthRange } from "@/lib/finance-shared";
import { atLocal } from "@/lib/time";
import { cancelAppointment, completeAppointment, rescheduleAppointment, scheduleAppointment, startAppointment, listOverdue } from "./appointments";
import { incomeStatement } from "./finance";

const RUN = `A${Date.now().toString(36).toUpperCase()}`;
const DAY = "2025-06-10"; // mês isolado no banco de testes
let p1: string, p2: string, seller: string, svc: string;
const gerente = () => ({ id: seller, seeAll: true });
const prest = (id: string) => ({ id, seeAll: false });

beforeAll(async () => {
  const mk = (suffix: string, role: string) =>
    prisma.user.create({ data: { id: `${RUN}-${suffix}`, name: `${suffix} ${RUN}`, email: `${suffix}-${RUN}@proserv.test`, role } });
  p1 = (await mk("p1", "prestador")).id;
  p2 = (await mk("p2", "prestador")).id;
  seller = (await mk("v", "vendedor")).id;
  svc = (await prisma.service.create({ data: { name: `Limpeza ${RUN}`, price: "180", estimatedCost: "30", durationMin: 60 } })).id;
});

afterAll(async () => {
  const appts = (await prisma.appointment.findMany({ where: { serviceId: svc }, select: { id: true } })).map((a) => a.id);
  await prisma.ledgerEntry.deleteMany({ where: { appointmentId: { in: appts }, reversesId: { not: null } } });
  await prisma.ledgerEntry.deleteMany({ where: { appointmentId: { in: appts } } });
  await prisma.appointment.deleteMany({ where: { id: { in: appts } } });
  await prisma.customer.deleteMany({ where: { name: { startsWith: RUN } } });
  await prisma.service.deleteMany({ where: { id: svc } });
  await prisma.user.deleteMany({ where: { id: { startsWith: RUN } } });
  await prisma.$disconnect();
});

const book = (providerId: string, time: string, customer = `${RUN} Maria`) =>
  scheduleAppointment({ serviceId: svc, providerId, customer: { name: customer, phone: "(11) 99999-0000" }, startsAt: atLocal(DAY, time), userId: seller });

describe("agenda (integração com Postgres)", () => {
  it("agenda com fim calculado pela duração e reaproveita o cliente", async () => {
    const a = await book(p1, "09:00");
    expect(a.endsAt.toISOString()).toBe(atLocal(DAY, "10:00").toISOString());
    const b = await book(p2, "09:00");
    expect(b.customerId).toBe(a.customerId); // mesmo nome + telefone
  });

  it("bloqueia choque de horário do mesmo prestador, aceita horário encostado", async () => {
    await expect(book(p1, "09:30")).rejects.toThrow(/Horário ocupado/);
    await expect(book(p1, "08:30")).rejects.toThrow(/Horário ocupado/);
    const next = await book(p1, "10:00"); // começa quando o anterior termina
    expect(next.id).toBeTruthy();
  });

  it("agendamentos simultâneos no mesmo horário: só um entra", async () => {
    const results = await Promise.allSettled(Array.from({ length: 5 }, (_, i) => book(p2, "14:00", `${RUN} Cliente ${i}`)));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });

  it("só aceita prestador como responsável", async () => {
    await expect(book(seller, "15:00")).rejects.toThrow(/prestador válido/);
  });

  it("prestador não mexe em atendimento de outro", async () => {
    const a = await book(p1, "16:00");
    await expect(startAppointment({ id: a.id, actor: prest(p2), now: atLocal(DAY, "16:00") })).rejects.toThrow(/outro prestador/);
  });

  it("não inicia com mais de 1 h de antecedência", async () => {
    const a = await book(p1, "18:00");
    await expect(startAppointment({ id: a.id, actor: prest(p1), now: atLocal(DAY, "16:30") })).rejects.toThrow(/1 hora antes/);
    const ok = await startAppointment({ id: a.id, actor: prest(p1), now: atLocal(DAY, "17:15") });
    expect(ok.status).toBe("EM_ANDAMENTO");
  });

  it("remarcar respeita choque e libera o horário antigo", async () => {
    const a = await book(p2, "11:00");
    await expect(rescheduleAppointment({ id: a.id, startsAt: atLocal(DAY, "09:30"), actor: gerente() })).rejects.toThrow(/Horário ocupado/);
    await rescheduleAppointment({ id: a.id, startsAt: atLocal(DAY, "12:00"), actor: gerente() });
    expect((await book(p2, "11:00", `${RUN} Outro`)).id).toBeTruthy();
  });

  it("cancelar agendado libera o horário", async () => {
    const a = await book(p1, "07:00");
    await cancelAppointment({ id: a.id, reason: "Cliente remarcou", actor: prest(p1), now: atLocal(DAY, "06:00") });
    expect((await book(p1, "07:00", `${RUN} Novo`)).id).toBeTruthy();
  });

  it("concluir lança receita (valor cobrado) e custo estimado na DRE do dia do atendimento", async () => {
    const before = await incomeStatement(monthRange("2025-06").from, monthRange("2025-06").to);
    const a = await book(p1, "11:00");
    const done = await completeAppointment({ id: a.id, chargedPrice: "200", paymentMethod: "PIX", actor: prest(p1), now: atLocal("2025-06-11", "09:00") });
    expect(done.status).toBe("CONCLUIDO");
    const entries = await prisma.ledgerEntry.findMany({ where: { appointmentId: a.id }, orderBy: { kind: "asc" } });
    const got = entries.map((e) => [e.kind, e.amount.toFixed(2), e.occurredAt.toISOString()]).sort();
    expect(got).toEqual(
      [
        ["DESPESA", "-30.00", atLocal(DAY, "11:00").toISOString()],
        ["RECEITA_SERVICO", "200.00", atLocal(DAY, "11:00").toISOString()],
      ].sort(),
    );
    const after = await incomeStatement(monthRange("2025-06").from, monthRange("2025-06").to);
    expect(Number(after.receitaServicos) - Number(before.receitaServicos)).toBe(200);
    expect(Number(after.resultado) - Number(before.resultado)).toBe(170);
    expect(after.despesasPorCategoria.find((c) => c.category === "Custo de serviços")).toBeTruthy();
    await expect(completeAppointment({ id: a.id, paymentMethod: "PIX", actor: prest(p1), now: atLocal(DAY, "12:00") })).rejects.toThrow(/já foi concluído/);
  });

  it("concluído: prestador não cancela; gerente cancela e estorna tudo", async () => {
    const a = await book(p2, "17:00");
    await completeAppointment({ id: a.id, paymentMethod: "DINHEIRO", actor: prest(p2), now: atLocal(DAY, "18:00") });
    await expect(cancelAppointment({ id: a.id, reason: "erro", actor: prest(p2) })).rejects.toThrow(/Só gerente/);
    const before = await incomeStatement(monthRange("2025-06").from, monthRange("2025-06").to);
    await cancelAppointment({ id: a.id, reason: "Lançado no cliente errado", actor: gerente(), now: atLocal(DAY, "19:00") });
    const after = await incomeStatement(monthRange("2025-06").from, monthRange("2025-06").to);
    expect(Number(after.receitaLiquida) - Number(before.receitaLiquida)).toBe(-180);
    expect(Number(after.resultado) - Number(before.resultado)).toBe(-150); // 180 − 30
    await expect(cancelAppointment({ id: a.id, reason: "de novo", actor: gerente() })).rejects.toThrow(/já foi cancelado/);
  });

  it("lista pendentes: horário passou e não foi concluído", async () => {
    const overdue = await listOverdue({ now: atLocal(DAY, "23:59"), providerId: p1 });
    expect(overdue.map((o) => o.status).every((s) => s === "AGENDADO" || s === "EM_ANDAMENTO")).toBe(true);
    expect(overdue.length).toBeGreaterThan(0);
  });
});

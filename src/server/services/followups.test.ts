import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { atLocal } from "@/lib/time";
import { cancelAppointment, completeAppointment, scheduleAppointment } from "./appointments";
import { createCustomer, eraseCustomer, mergeCustomers } from "./customers";
import { closeFollowUp, createFollowUp, followUpForecast, fromDate, listFollowUps, registerContact, rescheduleFollowUp } from "./followups";

const RUN = `F${Date.now().toString(36).toUpperCase()}`;
let prov: string, mgr: string, inst: string, manut: string, avulso: string;
const actor = () => ({ id: mgr, seeAll: true });

beforeAll(async () => {
  prov = (await prisma.user.create({ data: { id: `${RUN}-p`, name: `Prest ${RUN}`, email: `p-${RUN}@proserv.test`, role: "prestador" } })).id;
  mgr = (await prisma.user.create({ data: { id: `${RUN}-g`, name: `Ger ${RUN}`, email: `g-${RUN}@proserv.test`, role: "gerente" } })).id;
  manut = (await prisma.service.create({ data: { name: `Manutenção ${RUN}`, price: "180", durationMin: 60, returnAfterMonths: 6 } })).id;
  inst = (await prisma.service.create({ data: { name: `Instalação ${RUN}`, price: "350", durationMin: 60, returnAfterMonths: 6, returnServiceId: manut } })).id;
  avulso = (await prisma.service.create({ data: { name: `Visita ${RUN}`, price: "90", durationMin: 30 } })).id;
});

afterAll(async () => {
  const services = [inst, manut, avulso];
  const appts = (await prisma.appointment.findMany({ where: { serviceId: { in: services } }, select: { id: true } })).map((a) => a.id);
  await prisma.followUp.deleteMany({ where: { serviceId: { in: services } } });
  await prisma.ledgerEntry.deleteMany({ where: { appointmentId: { in: appts }, reversesId: { not: null } } });
  await prisma.ledgerEntry.deleteMany({ where: { appointmentId: { in: appts } } });
  await prisma.appointment.deleteMany({ where: { id: { in: appts } } });
  await prisma.auditLog.deleteMany({ where: { actorId: { in: [mgr, prov] } } });
  await prisma.customer.deleteMany({ where: { name: { contains: RUN } } });
  await prisma.service.updateMany({ where: { id: { in: services } }, data: { returnServiceId: null } });
  await prisma.service.deleteMany({ where: { id: { in: services } } });
  await prisma.user.deleteMany({ where: { id: { startsWith: RUN } } });
  await prisma.$disconnect();
});

async function done(customerId: string, serviceId: string, date: string, opts: { followUpOn?: string | null } = {}) {
  const a = await scheduleAppointment({ serviceId, providerId: prov, customer: { id: customerId }, startsAt: atLocal(date, "09:00"), userId: mgr });
  await completeAppointment({ id: a.id, paymentMethod: "PIX", actor: actor(), now: atLocal(date, "09:00"), ...opts });
  return a.id;
}
const open = (customerId: string) => prisma.followUp.findMany({ where: { customerId, status: { in: ["PENDENTE", "AGENDADO"] } }, include: { service: true } });

describe("retornos (integração com Postgres)", () => {
  let ana: string;

  it("concluir instalação programa a manutenção para daqui 6 meses", async () => {
    ana = (await createCustomer({ name: `Ana ${RUN}`, phone: "11998887766" })).id;
    await done(ana, inst, "2025-01-31");
    const [f] = await open(ana);
    expect(f.service.name).toBe(`Manutenção ${RUN}`);
    expect(fromDate(f.dueOn)).toBe("2025-07-31");
    expect(f.status).toBe("PENDENTE");
  });

  it("serviço sem retorno não gera nada; dá para dispensar ou mudar a data ao concluir", async () => {
    const bia = (await createCustomer({ name: `Bia ${RUN}` })).id;
    await done(bia, avulso, "2025-02-03");
    expect(await open(bia)).toHaveLength(0);
    await done(bia, manut, "2025-02-04", { followUpOn: null });
    expect(await open(bia)).toHaveLength(0);
    await done(bia, manut, "2025-02-05", { followUpOn: "2025-05-05" });
    expect(fromDate((await open(bia))[0].dueOn)).toBe("2025-05-05");
    await expect(done(bia, manut, "2025-02-06", { followUpOn: "2025-02-06" })).rejects.toThrow(/depois do atendimento/);
  });

  it("agendar o serviço do retorno marca agendado; cancelar devolve; concluir realiza e gera o próximo", async () => {
    const a = await scheduleAppointment({ serviceId: manut, providerId: prov, customer: { id: ana }, startsAt: atLocal("2025-07-28", "09:00"), userId: mgr });
    let [f] = await open(ana);
    expect(f.status).toBe("AGENDADO");
    expect(f.appointmentId).toBe(a.id);

    await cancelAppointment({ id: a.id, reason: "Viajou", actor: actor(), now: atLocal("2025-07-27", "09:00") });
    [f] = await open(ana);
    expect(f.status).toBe("PENDENTE");
    expect(f.appointmentId).toBeNull();

    const b = await done(ana, manut, "2025-08-04");
    const fulfilled = await prisma.followUp.findUniqueOrThrow({ where: { id: f.id } });
    expect(fulfilled).toMatchObject({ status: "REALIZADO", appointmentId: b });
    const [next] = await open(ana);
    expect(next.id).not.toBe(f.id);
    expect(fromDate(next.dueOn)).toBe("2026-02-04");
  });

  it("cancelar o atendimento concluído reabre o retorno cumprido e encerra o que ele gerou", async () => {
    const last = await prisma.appointment.findFirstOrThrow({ where: { customerId: ana, serviceId: manut, status: "CONCLUIDO" }, orderBy: { startsAt: "desc" } });
    await cancelAppointment({ id: last.id, reason: "Lançado errado", actor: actor(), now: atLocal("2025-08-05", "09:00") });
    const opened = await open(ana);
    expect(opened).toHaveLength(1);
    expect(fromDate(opened[0].dueOn)).toBe("2025-07-31"); // o retorno original voltou
    expect(await prisma.followUp.count({ where: { sourceAppointmentId: last.id, status: "ENCERRADO" } })).toBe(1);
  });

  it("contato: sem resposta mantém, falar depois muda a data, não quer encerra", async () => {
    const [f] = await open(ana);
    const now = atLocal("2025-08-06", "10:00");
    await registerContact({ id: f.id, channel: "WHATSAPP", outcome: "SEM_RESPOSTA", actorId: mgr, now });
    await expect(registerContact({ id: f.id, channel: "LIGACAO", outcome: "FALAR_DEPOIS", snoozeTo: "2025-08-06", actorId: mgr, now })).rejects.toThrow(/a partir de amanhã/);
    await registerContact({ id: f.id, channel: "LIGACAO", outcome: "FALAR_DEPOIS", snoozeTo: "2025-09-01", note: "Volta de viagem em setembro", actorId: mgr, now });
    const after = await prisma.followUp.findUniqueOrThrow({ where: { id: f.id }, include: { contacts: true } });
    expect(fromDate(after.dueOn)).toBe("2025-09-01");
    expect(after.contacts).toHaveLength(2);

    await rescheduleFollowUp({ id: f.id, dueOn: "2025-09-10", now });
    await registerContact({ id: f.id, channel: "LIGACAO", outcome: "NAO_QUER", note: "Trocou de aparelho", actorId: mgr, now });
    expect(await prisma.followUp.findUniqueOrThrow({ where: { id: f.id } })).toMatchObject({ status: "ENCERRADO", closedReason: "Trocou de aparelho" });
    await expect(registerContact({ id: f.id, channel: "OUTRO", outcome: "SEM_RESPOSTA", actorId: mgr, now })).rejects.toThrow(/não está mais pendente/);
  });

  it("programar à mão recusa repetido; abas e previsão contam certo", async () => {
    const now = atLocal("2025-09-01", "10:00");
    const c = (await createCustomer({ name: `Caio ${RUN}` })).id;
    const late = await createFollowUp({ customerId: c, serviceId: manut, dueOn: "2025-09-01", actorId: mgr, now });
    await expect(createFollowUp({ customerId: c, serviceId: manut, dueOn: "2025-10-01", actorId: mgr, now })).rejects.toThrow(/Já existe um retorno/);
    await createFollowUp({ customerId: c, serviceId: inst, dueOn: "2025-09-20", actorId: mgr, now });

    const later = atLocal("2025-09-03", "10:00");
    const tabs = await listFollowUps({ tab: "atrasados", q: RUN, now: later });
    expect(tabs.rows.map((r) => r.id)).toContain(late.id);
    expect(tabs.counts.proximos).toBeGreaterThanOrEqual(1); // instalação em 20/09
    const byPhone = await listFollowUps({ tab: "depois", q: "998887766", now: later });
    expect(byPhone.rows.every((r) => r.customer.id === ana)).toBe(true);

    const f = await followUpForecast({ now: later });
    expect(f.overdue).toBeGreaterThanOrEqual(1);
    expect(Number(f.value)).toBeGreaterThanOrEqual(530); // 180 + 350 deste teste
  });

  it("juntar cadastros deixa um retorno aberto por serviço; excluir dados apaga os retornos", async () => {
    const now = atLocal("2025-09-01", "10:00");
    const dup = (await createCustomer({ name: `Caio Dup ${RUN}` })).id;
    await createFollowUp({ customerId: dup, serviceId: manut, dueOn: "2025-12-01", actorId: mgr, now });
    const caio = (await prisma.customer.findFirstOrThrow({ where: { name: `Caio ${RUN}` } })).id;
    await mergeCustomers({ sourceId: dup, targetId: caio, actorId: mgr });
    const manutOpen = await prisma.followUp.findMany({ where: { customerId: caio, serviceId: manut, status: "PENDENTE" } });
    expect(manutOpen.map((x) => fromDate(x.dueOn))).toEqual(["2025-09-01"]);

    await eraseCustomer({ id: caio, actorId: mgr });
    expect(await prisma.followUp.count({ where: { customerId: caio } })).toBe(0);
    await expect(closeFollowUp({ id: manutOpen[0].id, reason: "x x x", actorId: mgr })).rejects.toThrow(/não encontrado/);
  });
});

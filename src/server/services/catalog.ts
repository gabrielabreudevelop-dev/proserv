/** Catálogo de serviços e clientes. */
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { DomainError } from "./errors";

export type ServiceRow = {
  id: string;
  name: string;
  description: string | null;
  price: string;
  /** Só para quem vê o financeiro. */
  estimatedCost?: string;
  durationMin: number;
  active: boolean;
  appointmentsCount: number;
};

export async function listServices({ includeCost, includeInactive = false }: { includeCost: boolean; includeInactive?: boolean }) {
  const rows = await prisma.service.findMany({
    where: includeInactive ? {} : { active: true },
    include: { _count: { select: { appointments: true } } },
    orderBy: { name: "asc" },
  });
  return rows.map<ServiceRow>((s) => ({
    id: s.id,
    name: s.name,
    description: s.description,
    price: s.price.toString(),
    ...(includeCost ? { estimatedCost: s.estimatedCost.toString() } : {}),
    durationMin: s.durationMin,
    active: s.active,
    appointmentsCount: s._count.appointments,
  }));
}

export type ServiceInput = { name: string; description?: string; price: string; estimatedCost: string; durationMin: number };

function validate(input: ServiceInput) {
  if (input.durationMin < 5 || input.durationMin > 12 * 60) throw new DomainError("Duração entre 5 minutos e 12 horas.", { durationMin: "Entre 5 e 720 min" });
  if (new Prisma.Decimal(input.estimatedCost).gt(input.price)) {
    // Permitido, mas avisamos: serviço daria prejuízo.
    return { warning: "O custo estimado é maior que o preço: este serviço dá prejuízo." };
  }
  return {};
}

async function assertUniqueName(name: string, exceptId?: string) {
  const clash = await prisma.service.findFirst({ where: { name: { equals: name.trim(), mode: "insensitive" }, active: true, ...(exceptId ? { id: { not: exceptId } } : {}) } });
  if (clash) throw new DomainError(`Já existe um serviço chamado "${name.trim()}".`, { name: "Nome já usado" });
}

export async function createService(input: ServiceInput) {
  const { warning } = validate(input);
  await assertUniqueName(input.name);
  const s = await prisma.service.create({
    data: { name: input.name.trim(), description: input.description?.trim() || null, price: input.price, estimatedCost: input.estimatedCost, durationMin: input.durationMin },
  });
  return { id: s.id, warning };
}

export async function updateService(id: string, input: ServiceInput) {
  const { warning } = validate(input);
  await assertUniqueName(input.name, id);
  await prisma.service.update({
    where: { id },
    data: { name: input.name.trim(), description: input.description?.trim() || null, price: input.price, estimatedCost: input.estimatedCost, durationMin: input.durationMin },
  });
  return { id, warning };
}

export async function setServiceActive(id: string, active: boolean) {
  await prisma.service.update({ where: { id }, data: { active } });
}

export async function listCustomers() {
  const rows = await prisma.customer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true, phone: true } });
  return rows;
}
export type CustomerOption = Awaited<ReturnType<typeof listCustomers>>[number];

/** Prestadores ativos: quem tem o cargo prestador (pode acumular outros). */
export async function listProviders() {
  const users = await prisma.user.findMany({
    where: { role: { contains: "prestador" }, OR: [{ banned: false }, { banned: null }] },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  return users;
}
export type ProviderOption = Awaited<ReturnType<typeof listProviders>>[number];

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
  /** Retorno recomendado (meses) e o serviço sugerido nele (nulo = o mesmo). */
  returnAfterMonths: number | null;
  returnServiceId: string | null;
  returnServiceName: string | null;
};

export async function listServices({ includeCost, includeInactive = false }: { includeCost: boolean; includeInactive?: boolean }) {
  const rows = await prisma.service.findMany({
    where: includeInactive ? {} : { active: true },
    include: { _count: { select: { appointments: true } }, returnService: { select: { name: true } } },
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
    returnAfterMonths: s.returnAfterMonths,
    returnServiceId: s.returnServiceId,
    returnServiceName: s.returnService?.name ?? null,
  }));
}

export type ServiceInput = {
  name: string;
  description?: string;
  price: string;
  estimatedCost: string;
  durationMin: number;
  returnAfterMonths?: number | null;
  returnServiceId?: string | null;
};

const returnData = (input: ServiceInput, selfId?: string) => {
  const months = input.returnAfterMonths || null;
  return {
    returnAfterMonths: months,
    // Sem retorno não guarda serviço; o próprio serviço também fica nulo ("o mesmo").
    returnServiceId: months && input.returnServiceId && input.returnServiceId !== selfId ? input.returnServiceId : null,
  };
};

async function validateReturn(input: ServiceInput) {
  if (input.returnAfterMonths != null && input.returnAfterMonths !== 0 && (input.returnAfterMonths < 1 || input.returnAfterMonths > 60)) {
    throw new DomainError("Retorno entre 1 e 60 meses.", { returnAfterMonths: "Entre 1 e 60" });
  }
  if (input.returnAfterMonths && input.returnServiceId) {
    const t = await prisma.service.findUnique({ where: { id: input.returnServiceId } });
    if (!t || !t.active) throw new DomainError("Escolha um serviço ativo para o retorno.", { returnServiceId: "Serviço inválido" });
  }
}

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
  await validateReturn(input);
  const s = await prisma.service.create({
    data: { name: input.name.trim(), description: input.description?.trim() || null, price: input.price, estimatedCost: input.estimatedCost, durationMin: input.durationMin, ...returnData(input) },
  });
  return { id: s.id, warning };
}

export async function updateService(id: string, input: ServiceInput) {
  const { warning } = validate(input);
  await assertUniqueName(input.name, id);
  await validateReturn(input);
  await prisma.service.update({
    where: { id },
    data: { name: input.name.trim(), description: input.description?.trim() || null, price: input.price, estimatedCost: input.estimatedCost, durationMin: input.durationMin, ...returnData(input, id) },
  });
  return { id, warning };
}

export async function setServiceActive(id: string, active: boolean) {
  await prisma.service.update({ where: { id }, data: { active } });
}

export { listCustomerOptions as listCustomers, type CustomerOption } from "./customers";

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

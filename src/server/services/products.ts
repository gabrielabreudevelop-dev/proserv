import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { buildCustomFieldsSchema, mergeCustomValues, type CustomValues } from "@/lib/custom-fields";
import { listFieldDefs } from "./custom-fields";
import { DomainError } from "./errors";
import { applyStockEntry } from "./stock";

export type ProductRow = {
  id: string;
  sku: string;
  name: string;
  category: string | null;
  salePrice: string;
  /** Ausente para cargos que não podem ver custo. */
  avgCost?: string;
  stockQty: string;
  minStock: string | null;
  active: boolean;
  customFields: CustomValues;
};

/**
 * Lista para a tabela. Valores Decimal viram string (seguro para o cliente).
 * Quando `includeCost` é falso, o custo nem sai do servidor.
 */
export async function listProducts({ includeCost, includeInactive = false }: { includeCost: boolean; includeInactive?: boolean }) {
  const rows = await prisma.product.findMany({
    where: includeInactive ? {} : { active: true },
    include: { category: { select: { name: true } } },
    orderBy: { name: "asc" },
  });
  return rows.map<ProductRow>((p) => ({
    id: p.id,
    sku: p.sku,
    name: p.name,
    category: p.category?.name ?? null,
    salePrice: p.salePrice.toString(),
    ...(includeCost ? { avgCost: p.avgCost.toString() } : {}),
    stockQty: p.stockQty.toString(),
    minStock: p.minStock?.toString() ?? null,
    active: p.active,
    customFields: (p.customFields ?? {}) as CustomValues,
  }));
}

export async function listCategoryNames() {
  const rows = await prisma.category.findMany({ orderBy: { name: "asc" }, select: { name: true } });
  return rows.map((c) => c.name);
}

export type ProductInput = {
  sku: string;
  name: string;
  category?: string;
  salePrice: string;
  minStock?: string;
  customFields: Record<string, unknown>;
};

export type NewProductInput = ProductInput & { initialQty?: string; initialCost?: string };

async function validateCustom(values: Record<string, unknown>) {
  const defs = await listFieldDefs();
  const parsed = buildCustomFieldsSchema(defs).safeParse(values);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) fieldErrors[`custom.${String(issue.path[0])}`] = issue.message;
    throw new DomainError("Revise os campos personalizados.", fieldErrors);
  }
  return { defs, values: parsed.data as CustomValues };
}

async function categoryId(tx: Prisma.TransactionClient, name?: string) {
  const clean = name?.trim();
  if (!clean) return null;
  const existing = await tx.category.findFirst({ where: { name: { equals: clean, mode: "insensitive" } } });
  return (existing ?? (await tx.category.create({ data: { name: clean } }))).id;
}

function rethrowUnique(e: unknown, sku: string): never {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
    throw new DomainError(`O SKU "${sku}" já está em uso.`, { sku: "SKU já cadastrado" });
  }
  throw e;
}

export async function createProduct(input: NewProductInput, userId: string) {
  const { defs, values } = await validateCustom(input.customFields);
  const sku = input.sku.trim().toUpperCase();
  try {
    return await prisma.$transaction(async (tx) => {
      const product = await tx.product.create({
        data: {
          sku,
          name: input.name.trim(),
          categoryId: await categoryId(tx, input.category),
          salePrice: input.salePrice,
          minStock: input.minStock || null,
          customFields: mergeCustomValues({}, values, defs),
        },
      });
      if (input.initialQty && new Prisma.Decimal(input.initialQty).gt(0)) {
        await applyStockEntry(tx, {
          productId: product.id,
          quantity: input.initialQty,
          unitCost: input.initialCost ?? "0",
          note: "Estoque inicial",
          userId,
        });
      }
      return product;
    });
  } catch (e) {
    rethrowUnique(e, sku);
  }
}

export async function updateProduct(id: string, input: ProductInput) {
  const current = await prisma.product.findUnique({ where: { id } });
  if (!current) throw new DomainError("Produto não encontrado.");
  const { defs, values } = await validateCustom(input.customFields);
  const sku = input.sku.trim().toUpperCase();
  try {
    return await prisma.$transaction(async (tx) =>
      tx.product.update({
        where: { id },
        data: {
          sku,
          name: input.name.trim(),
          categoryId: await categoryId(tx, input.category),
          salePrice: input.salePrice,
          minStock: input.minStock || null,
          customFields: mergeCustomValues(current.customFields as CustomValues, values, defs),
        },
      }),
    );
  } catch (e) {
    rethrowUnique(e, sku);
  }
}

export async function setProductActive(id: string, active: boolean) {
  return prisma.product.update({ where: { id }, data: { active } });
}

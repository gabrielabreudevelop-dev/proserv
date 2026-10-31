import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { diff } from "./audit";
import { createProduct, updateProduct } from "./products";
import { cancelSale, createSale } from "./sales";
import { registerStockEntry } from "./stock";

const RUN = `U${Date.now().toString(36).toUpperCase()}`;
let userId: string;
let productId: string;

beforeAll(async () => {
  userId = (await prisma.user.create({ data: { id: `${RUN}-u`, name: `Auditora ${RUN}`, email: `${RUN}@proserv.test`, role: "admin" } })).id;
  productId = (await createProduct({ sku: `${RUN}-P`, name: "Produto auditado", salePrice: "10", customFields: {} }, userId))!.id;
  await registerStockEntry({ productId, quantity: "5", unitCost: "4", userId });
});

afterAll(async () => {
  const sales = (await prisma.sale.findMany({ where: { sellerId: userId }, select: { id: true } })).map((s) => s.id);
  await prisma.ledgerEntry.deleteMany({ where: { saleId: { in: sales }, reversesId: { not: null } } });
  await prisma.ledgerEntry.deleteMany({ where: { saleId: { in: sales } } });
  await prisma.stockMovement.deleteMany({ where: { productId } });
  await prisma.saleItem.deleteMany({ where: { saleId: { in: sales } } });
  await prisma.sale.deleteMany({ where: { id: { in: sales } } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.category.deleteMany({ where: { name: "Nova", products: { none: {} } } });
  await prisma.auditLog.deleteMany({ where: { actorId: userId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("auditoria", () => {
  it("diff só traz o que mudou", () => {
    expect(diff({ a: 1, b: "x", c: null }, { a: 1, b: "y", c: "" })).toEqual({ b: ["x", "y"] });
  });

  it("entrada de estoque registra custo médio antes e depois", async () => {
    const log = await prisma.auditLog.findFirst({ where: { actorId: userId, action: "estoque.entrada" } });
    expect(log?.actorName).toBe(`Auditora ${RUN}`);
    expect(log?.summary).toContain("Entrada de 5 un.");
  });

  it("venda e cancelamento ficam registrados com nome de quem fez", async () => {
    const { sale } = await createSale({ items: [{ productId, quantity: "2" }], discount: "1", paymentMethod: "PIX", sellerId: userId });
    await cancelSale({ saleId: sale.id, userId, reason: "Teste de auditoria" });
    const logs = await prisma.auditLog.findMany({ where: { entityId: sale.id }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => l.action)).toEqual(["venda.registrar", "venda.cancelar"]);
    expect(logs[0].summary.replace(/ /g, " ")).toContain(`venda nº ${sale.number}: 2× Produto auditado · total R$ 19,00 (desconto R$ 1,00)`);
    expect(logs[1].summary).toContain("Teste de auditoria");
  });

  it("venda recusada não deixa registro (mesma transação)", async () => {
    const before = await prisma.auditLog.count({ where: { actorId: userId } });
    await expect(createSale({ items: [{ productId, quantity: "999" }], paymentMethod: "PIX", sellerId: userId })).rejects.toThrow(/insuficiente/);
    expect(await prisma.auditLog.count({ where: { actorId: userId } })).toBe(before);
  });

  it("edição de produto devolve antes e depois", async () => {
    const { changes } = await updateProduct(productId, { sku: `${RUN}-P`, name: "Produto auditado", salePrice: "12,5".replace(",", "."), category: "Nova", customFields: {} });
    const n = (v: unknown) => (typeof v === "string" ? v.replace(/\u00a0/g, " ") : v);
    expect(Object.fromEntries(Object.entries(changes).map(([k, [a, b]]) => [k, [n(a), n(b)]]))).toEqual({ "Preço de venda": ["R$ 10,00", "R$ 12,50"], Categoria: [null, "Nova"] });
  });
});

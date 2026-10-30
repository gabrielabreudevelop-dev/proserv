import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { nextAverageCost, registerStockAdjustment, registerStockEntry } from "./stock";
import { createProduct, updateProduct } from "./products";
import { createFieldDef, setFieldArchived } from "./custom-fields";
import { DomainError } from "./errors";

const RUN = `T${Date.now().toString(36).toUpperCase()}`;
const USER = "test-user";

describe("nextAverageCost (puro)", () => {
  it("pondera pelo estoque atual", () => {
    // 10 un. a 2,00 + 30 un. a 3,00 = 110 / 40 = 2,75
    expect(nextAverageCost(10, 2, 30, 3).toString()).toBe("2.75");
  });
  it("com estoque zerado assume o custo da entrada", () => {
    expect(nextAverageCost(0, 5, 10, 1.5).toString()).toBe("1.5");
  });
  it("arredonda em 4 casas", () => {
    expect(nextAverageCost(3, 1, 1, 2).toString()).toBe("1.25");
    expect(nextAverageCost(3, 1, 3, 1.3333).toString()).toBe("1.1667");
  });
});

describe("estoque (integração com Postgres)", () => {
  let productId: string;

  beforeAll(async () => {
    const p = await createProduct(
      { sku: `${RUN}-A`, name: "Produto teste", salePrice: "10", customFields: {}, initialQty: "10", initialCost: "2" },
      USER,
    );
    productId = p!.id;
  });

  afterAll(async () => {
    const products = await prisma.product.findMany({ where: { sku: { startsWith: RUN } }, select: { id: true } });
    const ids = products.map((p) => p.id);
    const movements = await prisma.stockMovement.findMany({ where: { productId: { in: ids } }, select: { id: true } });
    await prisma.ledgerEntry.deleteMany({ where: { stockMovementId: { in: movements.map((m) => m.id) } } });
    await prisma.stockMovement.deleteMany({ where: { productId: { in: ids } } });
    await prisma.product.deleteMany({ where: { id: { in: ids } } });
    await prisma.customFieldDefinition.deleteMany({ where: { label: { startsWith: RUN } } });
    await prisma.$disconnect();
  });

  it("cadastro com estoque inicial registra ENTRADA e custo", async () => {
    const p = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(p.stockQty.toString()).toBe("10");
    expect(p.avgCost.toString()).toBe("2");
    const mv = await prisma.stockMovement.findMany({ where: { productId } });
    expect(mv).toHaveLength(1);
    expect(mv[0].type).toBe("ENTRADA");
  });

  it("entrada recalcula o custo médio", async () => {
    await registerStockEntry({ productId, quantity: "30", unitCost: "3", userId: USER });
    const p = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(p.stockQty.toString()).toBe("40");
    expect(p.avgCost.toString()).toBe("2.75");
  });

  it("perda baixa estoque e gera DESPESA ao custo médio, sem mudar o custo", async () => {
    const { ledgerEntry } = await registerStockAdjustment({ productId, delta: "-4", reason: "PERDA", userId: USER });
    const p = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(p.stockQty.toString()).toBe("36");
    expect(p.avgCost.toString()).toBe("2.75");
    expect(ledgerEntry?.kind).toBe("DESPESA");
    expect(ledgerEntry?.amount.toString()).toBe("-11"); // 4 × 2,75
  });

  it("correção positiva de contagem não gera lançamento", async () => {
    const { ledgerEntry, product } = await registerStockAdjustment({ productId, delta: "1", reason: "CONTAGEM", userId: USER });
    expect(ledgerEntry).toBeNull();
    expect(product.stockQty.toString()).toBe("37");
  });

  it("bloqueia estoque negativo e perda com valor positivo", async () => {
    await expect(registerStockAdjustment({ productId, delta: "-999", reason: "PERDA", userId: USER })).rejects.toThrow(/insuficiente/);
    await expect(registerStockAdjustment({ productId, delta: "2", reason: "PERDA", userId: USER })).rejects.toBeInstanceOf(DomainError);
    await expect(registerStockEntry({ productId, quantity: "0", unitCost: "1", userId: USER })).rejects.toBeInstanceOf(DomainError);
    const p = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect(p.stockQty.toString()).toBe("37");
  });

  it("entradas simultâneas não perdem atualização (trava de linha)", async () => {
    const p0 = await createProduct({ sku: `${RUN}-B`, name: "Concorrência", salePrice: "5", customFields: {} }, USER);
    await Promise.all(
      Array.from({ length: 8 }, (_, i) => registerStockEntry({ productId: p0!.id, quantity: "1", unitCost: String(i + 1), userId: USER })),
    );
    const p = await prisma.product.findUniqueOrThrow({ where: { id: p0!.id } });
    expect(p.stockQty.toString()).toBe("8");
    // Média de 1..8 = 4,5. A ordem das entradas varia e cada passo arredonda em 4 casas,
    // então aceitamos diferença menor que 0,001.
    expect(Math.abs(p.avgCost.toNumber() - 4.5)).toBeLessThan(0.001);
  });

  it("SKU duplicado vira erro de negócio", async () => {
    await expect(
      createProduct({ sku: `${RUN}-a`, name: "Duplicado", salePrice: "1", customFields: {} }, USER),
    ).rejects.toThrow(/já está em uso/);
  });

  it("campo novo funciona sem migração e arquivar preserva o valor", async () => {
    const field = await createFieldDef({
      label: `${RUN} Garantia`,
      type: "NUMBER",
      options: [],
      required: false,
      visibleByDefault: true,
    });
    await updateProduct(productId, {
      sku: `${RUN}-A`,
      name: "Produto teste",
      salePrice: "10",
      customFields: { [field.key]: "12" },
    });
    let p = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect((p.customFields as Prisma.JsonObject)[field.key]).toBe(12);

    // filtro JSONB por caminho
    const found = await prisma.product.findMany({ where: { customFields: { path: [field.key], equals: 12 } } });
    expect(found.map((f) => f.id)).toContain(productId);

    await setFieldArchived(field.id, true);
    await updateProduct(productId, { sku: `${RUN}-A`, name: "Produto teste", salePrice: "10", customFields: {} });
    p = await prisma.product.findUniqueOrThrow({ where: { id: productId } });
    expect((p.customFields as Prisma.JsonObject)[field.key]).toBe(12);
  });
});

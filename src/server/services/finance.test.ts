/**
 * Critério de saída da Fase 2: o sistema reproduz a planilha de conferência
 * (docs/conferencia-financeira.md) centavo a centavo.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { monthRange } from "@/lib/finance-shared";
import { createExpense, incomeStatement, listLedger, reverseExpense } from "./finance";
import { createProduct } from "./products";
import { cancelSale, createSale } from "./sales";
import { registerStockAdjustment, registerStockEntry } from "./stock";

const RUN = `F${Date.now().toString(36).toUpperCase()}`;
const brt = (isoLocal: string) => new Date(`${isoLocal}-03:00`);
let sellerId: string;
let A: string;
let B: string;

async function cleanup() {
  const ids = (await prisma.product.findMany({ where: { sku: { startsWith: RUN } }, select: { id: true } })).map((p) => p.id);
  const sales = (await prisma.sale.findMany({ where: { items: { some: { productId: { in: ids } } } }, select: { id: true } })).map((s) => s.id);
  const range = { gte: brt("2025-03-01T00:00:00"), lt: brt("2025-05-01T00:00:00") };
  await prisma.ledgerEntry.deleteMany({ where: { reversesId: { not: null }, occurredAt: range } });
  await prisma.ledgerEntry.deleteMany({ where: { occurredAt: range } });
  await prisma.stockMovement.deleteMany({ where: { productId: { in: ids } } });
  await prisma.saleItem.deleteMany({ where: { saleId: { in: sales } } });
  await prisma.sale.deleteMany({ where: { id: { in: sales } } });
  await prisma.product.deleteMany({ where: { id: { in: ids } } });
}

beforeAll(async () => {
  // Garante um mês limpo no banco de testes.
  const range = { gte: brt("2025-03-01T00:00:00"), lt: brt("2025-05-01T00:00:00") };
  await prisma.ledgerEntry.deleteMany({ where: { reversesId: { not: null }, occurredAt: range } });
  await prisma.ledgerEntry.deleteMany({ where: { occurredAt: range } });
  await prisma.sale.deleteMany({ where: { createdAt: range } });

  const user = await prisma.user.upsert({
    where: { email: "conferencia@proserv.test" },
    update: {},
    create: { id: `u-${RUN}`, name: "Conferência", email: "conferencia@proserv.test", role: "vendedor" },
  });
  sellerId = user.id;
  A = (await createProduct({ sku: `${RUN}-A`, name: "Produto A", salePrice: "10", customFields: {} }, sellerId))!.id;
  B = (await createProduct({ sku: `${RUN}-B`, name: "Produto B", salePrice: "50", customFields: {} }, sellerId))!.id;
});

afterAll(async () => {
  await cleanup();
  await prisma.$disconnect();
});

describe("planilha de conferência — março/2025", () => {
  let venda3: string;

  it("executa as operações da planilha", async () => {
    const at = brt("2025-03-03T09:00:00");
    await registerStockEntry({ productId: A, quantity: "10", unitCost: "4", userId: sellerId, at });
    await registerStockEntry({ productId: A, quantity: "10", unitCost: "6", userId: sellerId, at });
    await registerStockEntry({ productId: B, quantity: "5", unitCost: "20", userId: sellerId, at });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: A } })).avgCost.toFixed(2)).toBe("5.00");

    const v1 = await createSale({ items: [{ productId: A, quantity: "3" }, { productId: B, quantity: "1" }], discount: "5", paymentMethod: "PIX", sellerId, at: brt("2025-03-05T10:00:00") });
    expect(v1.sale.total.toFixed(2)).toBe("75.00");
    expect(v1.cmv.toFixed(2)).toBe("35.00");

    await createSale({ items: [{ productId: A, quantity: "2" }], paymentMethod: "DINHEIRO", sellerId, at: brt("2025-03-10T10:00:00") });
    const v3 = await createSale({ items: [{ productId: B, quantity: "2" }], paymentMethod: "CREDITO", sellerId, at: brt("2025-03-12T10:00:00") });
    venda3 = v3.sale.id;
    await cancelSale({ saleId: venda3, userId: sellerId, reason: "Cliente desistiu", at: brt("2025-03-13T10:00:00") });

    await registerStockAdjustment({ productId: A, delta: "-1", reason: "PERDA", userId: sellerId, at: brt("2025-03-15T10:00:00") });
    await createExpense({ amount: "30", category: "Aluguel", description: "Aluguel março", occurredAt: brt("2025-03-20T10:00:00"), userId: sellerId });
    await createExpense({ amount: "12.50", category: "Energia", description: "Conta de luz", occurredAt: brt("2025-03-25T10:00:00"), userId: sellerId });
    const internet = await createExpense({ amount: "9.90", category: "Internet e telefone", description: "Lançada por engano", occurredAt: brt("2025-03-26T10:00:00"), userId: sellerId });
    await reverseExpense({ entryId: internet.id, userId: sellerId, at: brt("2025-03-26T11:00:00") });

    await createSale({ items: [{ productId: A, quantity: "1" }], paymentMethod: "PIX", sellerId, at: brt("2025-03-31T23:30:00") });
    await createSale({ items: [{ productId: A, quantity: "1" }], paymentMethod: "PIX", sellerId, at: brt("2025-04-01T00:30:00") });
  });

  it("DRE de março bate com a planilha", async () => {
    const { from, to } = monthRange("2025-03");
    const dre = await incomeStatement(from, to);
    expect({
      receitaProdutos: dre.receitaProdutos,
      cancelamentos: dre.cancelamentos,
      receitaLiquida: dre.receitaLiquida,
      cmv: dre.cmv,
      lucroBruto: dre.lucroBruto,
      despesas: dre.despesas,
      resultado: dre.resultado,
      vendasConcluidas: dre.vendasConcluidas,
    }).toEqual({
      receitaProdutos: "205.00",
      cancelamentos: "-100.00",
      receitaLiquida: "105.00",
      cmv: "50.00",
      lucroBruto: "55.00",
      despesas: "47.50",
      resultado: "7.50",
      vendasConcluidas: 3,
    });
    expect(dre.margemBruta).toBeCloseTo(55 / 105, 6);
    expect(dre.despesasPorCategoria).toEqual([
      { category: "Aluguel", amount: "30.00" },
      { category: "Energia", amount: "12.50" },
      { category: "Perda de estoque", amount: "5.00" },
    ]);
  });

  it("abril só tem a venda 5", async () => {
    const { from, to } = monthRange("2025-04");
    const dre = await incomeStatement(from, to);
    expect([dre.receitaLiquida, dre.cmv, dre.despesas, dre.resultado]).toEqual(["10.00", "5.00", "0.00", "5.00"]);
  });

  it("estoque final bate com a planilha", async () => {
    const [a, b] = await Promise.all([A, B].map((id) => prisma.product.findUniqueOrThrow({ where: { id } })));
    expect(a.stockQty.toString()).toBe("12");
    expect(b.stockQty.toString()).toBe("4");
    expect(b.avgCost.toFixed(2)).toBe("20.00");
  });

  it("não cancela duas vezes nem estorna despesa duas vezes", async () => {
    await expect(cancelSale({ saleId: venda3, userId: sellerId, reason: "de novo" })).rejects.toThrow(/já foi cancelada/);
    const { from, to } = monthRange("2025-03");
    const ledger = await listLedger({ from, to, kind: "DESPESA" });
    const internet = ledger.find((l) => l.category === "Internet e telefone")!;
    expect(internet.reversed).toBe(true);
    expect(internet.reversible).toBe(false);
    await expect(reverseExpense({ entryId: internet.id, userId: sellerId })).rejects.toThrow(/já foi estornada/);
    const perda = ledger.find((l) => l.category === "Perda de estoque")!;
    expect(perda.reversible).toBe(false);
  });

  it("venda sem estoque não altera nada", async () => {
    const before = await prisma.ledgerEntry.count();
    await expect(
      createSale({ items: [{ productId: A, quantity: "1" }, { productId: B, quantity: "999" }], paymentMethod: "PIX", sellerId, at: brt("2025-03-28T10:00:00") }),
    ).rejects.toThrow(/Estoque insuficiente de "Produto B"/);
    expect(await prisma.ledgerEntry.count()).toBe(before);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: A } })).stockQty.toString()).toBe("12");
  });

  it("desconto maior que o subtotal é recusado", async () => {
    await expect(
      createSale({ items: [{ productId: A, quantity: "1" }], discount: "10.01", paymentMethod: "PIX", sellerId, at: brt("2025-03-28T10:00:00") }),
    ).rejects.toThrow(/desconto não pode ser maior/);
  });

  it("vendas simultâneas não vendem além do estoque", async () => {
    // B tem 4 unidades; 6 vendas de 1 un. ao mesmo tempo → 4 passam, 2 falham.
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, () => createSale({ items: [{ productId: B, quantity: "1" }], paymentMethod: "PIX", sellerId, at: brt("2025-04-02T10:00:00") })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(4);
    expect((await prisma.product.findUniqueOrThrow({ where: { id: B } })).stockQty.toString()).toBe("0");
  });
});

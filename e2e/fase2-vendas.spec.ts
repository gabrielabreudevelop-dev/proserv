/**
 * Critério da Fase 2: o cenário da planilha (docs/conferencia-financeira.md) feito pela
 * interface move cada linha da DRE exatamente o previsto.
 */
import { expect, test, type Page } from "@playwright/test";
import { brl, norm, runId, sql, storage, toast } from "./helpers";

const RUN = runId();
const A = `E2A-${RUN}`;
const B = `E2B-${RUN}`;
const nameOf = (sku: string) => (sku === A ? `Conferência A ${RUN}` : `Conferência B ${RUN}`);
const month = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).format(new Date());

const DRE_LINES = ["Receita de produtos", "(−) Cancelamentos", "Receita líquida", "(−) Custo das mercadorias vendidas", "Lucro bruto", "(−) Despesas"] as const;
async function readDre(page: Page) {
  await page.goto(`/financeiro?mes=${month()}`);
  const out: Record<string, number> = {};
  for (const r of await page.locator("section[aria-labelledby='dre-title'] tr").all()) {
    const [label, value] = await r.locator("td").allTextContents();
    out[norm(label)] = brl(value);
  }
  out.Resultado = out["Lucro"] ?? out["Prejuízo"];
  return out;
}

async function newProduct(page: Page, sku: string, price: string, qty: string, cost: string) {
  await page.goto("/produtos");
  await page.getByRole("button", { name: "Novo produto" }).click();
  await page.fill("#sku", sku);
  await page.fill("#name", nameOf(sku));
  await page.fill("#salePrice", price);
  await page.fill("#initialQty", qty);
  await page.fill("#initialCost", cost);
  await page.getByRole("button", { name: "Cadastrar produto" }).click();
  await toast(page, /cadastrado/);
}

async function pdvSale(page: Page, items: [string, number][], discount: string, payment: string) {
  await page.goto("/vendas/nova");
  for (const [sku, qty] of items) {
    await page.fill('input[aria-label="Buscar produto"]', sku);
    await page.keyboard.press("Enter");
    await page.fill(`input[aria-label="Quantidade de ${nameOf(sku)}"]`, String(qty));
  }
  if (discount) await page.fill("#pdv-discount", discount);
  await page.getByRole("button", { name: payment, exact: true }).click();
  await page.keyboard.press("Control+Enter");
  const t = await toast(page, /Venda nº/);
  const m = /Venda nº (\d+) registrada · (R\$ [\d.,]+)/.exec(t)!;
  return { number: m[1], total: brl(m[2]) };
}

test.describe.serial("planilha de conferência pela interface (admin)", () => {
  test.use({ storageState: storage("admin") });
  let before: Record<string, number>;
  let v3: { number: string; total: number };

  test("lê a DRE antes", async ({ page }) => {
    before = await readDre(page);
  });

  test("produtos e entradas (custo médio A = 5,00)", async ({ page }) => {
    await newProduct(page, A, "10,00", "10", "4,00");
    await newProduct(page, B, "50,00", "5", "20,00");
    await page.fill('input[aria-label="Buscar produtos"]', A);
    await page.locator("tbody tr", { hasText: A }).getByRole("button", { name: /Ações de/ }).click();
    await page.getByRole("menuitem", { name: "Entrada de estoque" }).click();
    await page.fill("#entry-qty", "10");
    await page.fill("#entry-cost", "6,00");
    await page.getByRole("button", { name: "Registrar entrada" }).click();
    await toast(page, /Entrada registrada/);
    expect(await sql(`SELECT "avgCost"::text FROM "Product" WHERE sku = $1`, [A])).toBe("5.0000");
  });

  test("vendas no PDV com desconto e bloqueio acima do estoque", async ({ page }) => {
    expect((await pdvSale(page, [[A, 3], [B, 1]], "5", "Pix")).total).toBe(75);
    await expect(page.getByText("Nenhum item.")).toBeVisible();
    expect((await pdvSale(page, [[A, 2]], "", "Dinheiro")).total).toBe(20);
    v3 = await pdvSale(page, [[B, 2]], "", "Cartão de crédito");
    expect(v3.total).toBe(100);

    await page.fill('input[aria-label="Buscar produto"]', B);
    await page.keyboard.press("Enter");
    await page.fill(`input[aria-label="Quantidade de ${nameOf(B)}"]`, "3");
    await page.getByRole("button", { name: "Pix", exact: true }).click();
    await expect(page.getByRole("button", { name: "Finalizar venda" })).toBeDisabled();
    await expect(page.getByText("Máx. 2")).toBeVisible();
  });

  test("cancela a venda 3 e devolve o estoque", async ({ page }) => {
    await page.goto("/vendas");
    await page.getByRole("button", { name: `Cancelar venda ${v3.number}` }).click();
    await page.fill("#cancel-reason", "Cliente desistiu");
    await page.getByRole("button", { name: "Cancelar venda", exact: true }).click();
    await toast(page, /cancelada/);
    expect(await sql(`SELECT "stockQty"::text FROM "Product" WHERE sku = $1`, [B])).toBe("4.000");
  });

  test("perda de 1 A e despesas, uma estornada", async ({ page }) => {
    await page.goto("/produtos");
    await page.fill('input[aria-label="Buscar produtos"]', A);
    await page.locator("tbody tr", { hasText: A }).getByRole("button", { name: /Ações de/ }).click();
    await page.getByRole("menuitem", { name: "Ajustar estoque" }).click();
    await page.fill("#adj-qty", "1");
    await page.getByRole("button", { name: "Registrar ajuste" }).click();
    await toast(page, /Ajuste registrado/);

    for (const [amount, category, description] of [
      ["30,00", "Aluguel", `Aluguel ${RUN}`],
      ["12,50", "Energia", `Energia ${RUN}`],
      ["9,90", "Internet e telefone", `Engano ${RUN}`],
    ]) {
      await page.goto("/financeiro");
      await page.getByRole("button", { name: "Lançar despesa" }).click();
      await page.fill("#exp-amount", amount);
      await page.selectOption("#exp-category", category);
      await page.fill("#exp-description", description);
      await page.getByRole("dialog").getByRole("button", { name: "Lançar despesa" }).click();
      await toast(page, /lançada/);
    }
    await page.reload();
    await page.getByRole("button", { name: `Estornar Engano ${RUN}` }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Estornar" }).click();
    await toast(page, /estornada/);
  });

  test("DRE na tela variou exatamente o da planilha (+2,50)", async ({ page }) => {
    const after = await readDre(page);
    const delta = (k: string) => Math.round((after[k] - before[k]) * 100) / 100;
    expect(Object.fromEntries(DRE_LINES.map((k) => [k, delta(k)]))).toEqual({
      "Receita de produtos": 195,
      "(−) Cancelamentos": -100,
      "Receita líquida": 95,
      "(−) Custo das mercadorias vendidas": -45,
      "Lucro bruto": 50,
      "(−) Despesas": -47.5,
    });
    expect(delta("Resultado")).toBe(2.5);
    expect(after["Receita líquida"] + after["(−) Custo das mercadorias vendidas"] + after["(−) Despesas"]).toBeCloseTo(after.Resultado, 2);
    expect(await sql(`SELECT "stockQty"::text FROM "Product" WHERE sku = $1`, [A])).toBe("14.000");
  });

  test("tudo aparece na auditoria", async ({ page }) => {
    await page.goto(`/config/auditoria?mes=${month()}&q=${encodeURIComponent(RUN)}`);
    const text = norm(await page.locator("main table").textContent());
    expect(text).toContain(`Estornou a despesa "Engano ${RUN}"`);
    expect(text).toContain(`Cadastrou o produto ${A}`);
    expect(text).toContain(`Registrou a venda nº ${v3.number}: 2× ${nameOf(B)}`);
    // O resumo do cancelamento não leva o código da rodada: busca pelo número da venda.
    await page.goto(`/config/auditoria?mes=${month()}&area=Sale&q=${encodeURIComponent(`venda nº ${v3.number} `)}`);
    await expect(page.locator("main table")).toContainText(`Cancelou a venda nº ${v3.number} (R$ 100,00): Cliente desistiu`);
  });
});

test.describe("vendas (vendedor)", () => {
  test.use({ storageState: storage("vendedor") });
  test("só as próprias vendas, sem custo nem cancelamento", async ({ page }) => {
    await page.goto("/vendas");
    await expect(page.locator("h1")).toHaveText("Minhas vendas");
    const h = (await page.locator("thead th").allTextContents()).map(norm);
    expect(h).not.toContain("Vendedor");
    await expect(page.getByRole("button", { name: /Cancelar venda/ })).toHaveCount(0);
    await expect(page.getByText("Lucro bruto das vendas")).toHaveCount(0);
    const own = await sql(
      `SELECT count(*) FROM "Sale" s JOIN "user" u ON u.id = s."sellerId" WHERE u.email = 'vendedor@proserv.local' AND s."createdAt" >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`,
    );
    await expect(page.locator("[data-slot=table-body] > tr")).toHaveCount(Number(own) || 1);
    await page.getByRole("button", { name: /Ver itens da venda/ }).first().click();
    await expect(page.locator("tr.bg-muted\\/30").first()).not.toContainText("Custo");
  });
  test("bloqueado no Financeiro", async ({ page }) => {
    await page.goto("/financeiro");
    await expect(page).toHaveURL(/\/sem-acesso$/);
  });
});

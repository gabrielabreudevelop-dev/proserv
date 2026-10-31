import { expect, test, type Page } from "@playwright/test";
import { norm, runId, sql, storage, toast } from "./helpers";

const RUN = runId();
const SKU = `TST-${RUN}`;
const FIELD = `Cor ${RUN}`;

const headers = async (page: Page) => (await page.locator("thead th").allTextContents()).map((t) => t.trim()).filter(Boolean);
const row = (page: Page, text: string) => page.locator("tbody tr", { hasText: text }).first();
async function cell(page: Page, header: string) {
  const hs = (await page.locator("thead th").allTextContents()).map((t) => t.trim());
  return norm(await row(page, SKU).locator("td").nth(hs.indexOf(header)).textContent());
}

test.describe.serial("produtos (admin)", () => {
  test.use({ storageState: storage("admin") });

  test("campo novo pela tela vira coluna sem migração", async ({ page }) => {
    const migrations = await sql(`SELECT count(*) FROM "_prisma_migrations"`);
    await page.goto("/produtos/campos");
    await page.getByRole("button", { name: "Novo campo" }).click();
    await page.fill("#field-label", FIELD);
    await page.selectOption("#field-type", "SELECT");
    await page.fill("#field-options", "Azul, Verde\nPreto");
    await page.getByRole("button", { name: "Criar campo" }).click();
    await toast(page, /criado/);
    await page.goto("/produtos");
    expect(await headers(page)).toContain(FIELD);
    expect(await sql(`SELECT count(*) FROM "_prisma_migrations"`)).toBe(migrations);
  });

  test("ordena por nome respeitando acentos", async ({ page }) => {
    await page.goto("/produtos");
    const names = (await page.locator("tbody tr td:nth-child(3)").allTextContents()).map((s) => s.trim());
    const sorted = [...names].sort(new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true }).compare);
    expect(names).toEqual(sorted);
  });

  test("cadastro, entrada, perda e bloqueio de estoque negativo", async ({ page }) => {
    await page.goto("/produtos");
    await page.getByRole("button", { name: "Novo produto" }).click();
    await page.fill("#sku", SKU.toLowerCase());
    await page.fill("#name", `Produto E2E ${RUN}`);
    await page.fill("#category", "Testes");
    await page.fill("#salePrice", "10,00");
    await page.fill("#minStock", "5");
    await page.fill("#initialQty", "10");
    await page.fill("#initialCost", "4,00");
    await page.fill("#custom-vencimento", "2027-12-31");
    const key = await sql(`SELECT key FROM "CustomFieldDefinition" WHERE label = $1`, [FIELD]);
    await page.selectOption(`#custom-${key}`, "Azul");
    await page.getByRole("button", { name: "Cadastrar produto" }).click();
    await toast(page, /cadastrado/);

    await page.fill('input[aria-label="Buscar produtos"]', SKU);
    await expect(row(page, SKU)).toContainText("Azul");
    await expect(row(page, SKU)).toContainText("31/12/2027");
    expect(await cell(page, "Custo médio")).toBe("R$ 4,00");
    expect(await cell(page, "Margem")).toBe("60%");

    // Entrada: (10×4 + 10×6)/20 = 5
    await row(page, SKU).getByRole("button", { name: /Ações de/ }).click();
    await page.getByRole("menuitem", { name: "Entrada de estoque" }).click();
    await page.fill("#entry-qty", "10");
    await page.fill("#entry-cost", "6,00");
    await expect(page.getByRole("dialog")).toContainText("novo custo médio R$ 5,00");
    await page.getByRole("button", { name: "Registrar entrada" }).click();
    await toast(page, /Entrada registrada/);
    await expect.poll(() => cell(page, "Custo médio")).toBe("R$ 5,00");
    expect(await cell(page, "Estoque")).toBe("20");

    // Perda de 2 → despesa de 10,00
    await row(page, SKU).getByRole("button", { name: /Ações de/ }).click();
    await page.getByRole("menuitem", { name: "Ajustar estoque" }).click();
    await page.fill("#adj-qty", "2");
    await page.getByRole("button", { name: "Registrar ajuste" }).click();
    expect(await toast(page, /Ajuste registrado/)).toContain("R$ 10,00");
    expect(await sql(`SELECT amount::text FROM "LedgerEntry" WHERE description LIKE $1`, [`%E2E ${RUN}%`])).toBe("-10.00");
    await expect.poll(() => cell(page, "Estoque")).toBe("18");

    // Não deixa ficar negativo
    await row(page, SKU).getByRole("button", { name: /Ações de/ }).click();
    await page.getByRole("menuitem", { name: "Ajustar estoque" }).click();
    await page.fill("#adj-qty", "500");
    await page.getByRole("button", { name: "Registrar ajuste" }).click();
    await toast(page, /insuficiente/);
    await page.keyboard.press("Escape");

    // Histórico na linha expandida
    await row(page, SKU).getByRole("button", { name: "Ver detalhes" }).click();
    const hist = page.locator("section[aria-label='Últimas movimentações']");
    await expect(hist).toContainText("Perda ou avaria");
    await expect(hist.getByText("Entrada", { exact: true })).toHaveCount(2);
  });

  test("validações: SKU duplicado e preço inválido", async ({ page }) => {
    await page.goto("/produtos");
    await page.getByRole("button", { name: "Novo produto" }).click();
    await page.fill("#sku", SKU);
    await page.fill("#name", "Duplicado");
    await page.fill("#salePrice", "1");
    await page.getByRole("button", { name: "Cadastrar produto" }).click();
    await expect(page.locator("#sku-error")).toHaveText("SKU já cadastrado");
    await page.fill("#sku", `${SKU}-X`);
    await page.fill("#salePrice", "abc");
    await page.getByRole("button", { name: "Cadastrar produto" }).click();
    await expect(page.locator("#salePrice-error")).toContainText("inválido");
  });

  test("coluna oculta continua oculta após recarregar", async ({ page }) => {
    await page.goto("/produtos");
    await page.getByRole("button", { name: /Colunas/ }).click();
    await page.getByRole("menuitemcheckbox", { name: FIELD }).click();
    await page.keyboard.press("Escape");
    expect(await headers(page)).not.toContain(FIELD);
    await expect.poll(() => sql(`SELECT count(*) FROM "TablePreference"`), { timeout: 5000 }).not.toBe("0");
    await page.reload();
    expect(await headers(page)).not.toContain(FIELD);
  });

  test("filtro de estoque baixo só mostra alertas", async ({ page }) => {
    await page.goto("/produtos");
    await page.getByRole("button", { name: /Estoque baixo/ }).click();
    const rows = page.locator("tbody tr");
    const n = await rows.count();
    expect(n).toBeGreaterThan(0);
    await expect(page.locator("tbody tr", { hasText: /Baixo|Zerado/ })).toHaveCount(n);
  });
});

test.describe("produtos (vendedor)", () => {
  test.use({ storageState: storage("vendedor") });
  test("sem custo, sem margem, sem edição — nem no HTML", async ({ page }) => {
    await page.goto("/produtos");
    const h = await headers(page);
    expect(h).not.toContain("Custo médio");
    expect(h).not.toContain("Margem");
    await expect(page.getByRole("button", { name: "Novo produto" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Ações de/ })).toHaveCount(0);
    expect(await page.content()).not.toContain("avgCost");
    await page.getByRole("button", { name: "Ver detalhes" }).first().click();
    const hist = page.locator("section[aria-label='Últimas movimentações']");
    await expect(hist).toBeVisible();
    await expect(hist).not.toContainText("R$");
  });
});

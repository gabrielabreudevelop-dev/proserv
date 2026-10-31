// Verificação E2E da Fase 1 (Produtos). Uso: node e2e-fase1.mjs <pasta-screenshots>
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = "http://localhost:3000";
const OUT = process.argv[2];
const RUN = Date.now().toString(36).slice(-5).toUpperCase();
const SKU = `TST-${RUN}`;
const FIELD = `Cor ${RUN}`;
const sql = (q) => execSync(`su postgres -c "psql -d proserv -tAc \\"${q.replace(/"/g, '\\\\\\"')}\\""`).toString().trim();

const results = [];
const check = (name, ok, extra = "") => {
  const line = `${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`;
  results.push(line);
  console.log(line);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function login(browser, who) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
  await page.goto(`${BASE}/login`);
  await page.fill("#email", `${who}@proserv.local`);
  await page.fill("#password", "proserv123");
  await page.click("button[type=submit]");
  await page.waitForURL("**/dashboard", { timeout: 15000 });
  return { ctx, page };
}
const norm = (t) => (t ?? "").replace(/\u00a0/g, " ");
const toastText = async (page, re = /./) => {
  const t = page.locator("[data-sonner-toast]", { hasText: re }).first();
  await t.waitFor({ timeout: 10000 }).catch(() => {});
  const all = await page.locator("[data-sonner-toast]").allTextContents();
  return norm((await t.count()) ? await t.textContent() : all.join(" || "));
};
// Lê uma célula pelo título da coluna.
async function cell(page, sku, header) {
  const hs = (await page.locator("thead th").allTextContents()).map((t) => t.trim());
  const idx = hs.findIndex((h) => h === header || (header === "Detalhes" && h === ""));
  return norm(await rowOf(page, sku).locator("td").nth(idx).textContent()).trim();
}
const rowOf = (page, text) => page.locator("tbody tr", { hasText: text }).first();
const headers = async (page) => (await page.locator("thead th").allTextContents()).map((t) => t.trim()).filter(Boolean);

const browser = await chromium.launch();
const migrationsBefore = sql('SELECT count(*) FROM "_prisma_migrations"');

// ── ADMIN ────────────────────────────────────────────────
{
  const { ctx, page } = await login(browser, "admin");

  // 1. Criar campo personalizado pela tela
  await page.goto(`${BASE}/produtos/campos`);
  await page.getByRole("button", { name: "Novo campo" }).click();
  await page.fill("#field-label", FIELD);
  await page.selectOption("#field-type", "SELECT");
  await page.fill("#field-options", "Azul, Verde\nPreto");
  await page.getByRole("button", { name: "Criar campo" }).click();
  const t1 = await toastText(page, /criado/);
  check("cria campo SELECT pela tela", t1.includes("criado"), t1);
  check("campo listado na tela de campos", await page.locator("tbody tr", { hasText: FIELD }).count() === 1);

  // 2. Critério da fase: coluna aparece sem migração
  await page.goto(`${BASE}/produtos`);
  await page.waitForSelector("tbody tr");
  check("coluna nova aparece na tabela", (await headers(page)).includes(FIELD), (await headers(page)).join(" | "));
  check("nenhuma migração nova no banco", sql('SELECT count(*) FROM "_prisma_migrations"') === migrationsBefore, `migrações: ${migrationsBefore}`);

  // 3. Ordenação em português
  const names = (await page.locator("tbody tr td:nth-child(3)").allTextContents()).map((s) => s.trim());
  const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
  const sorted = [...names].sort(collator.compare);
  check("ordena por nome respeitando acentos", JSON.stringify(names) === JSON.stringify(sorted) && names[0].startsWith("Açúcar"), names.slice(0, 4).join(" | "));

  // 4. Cadastrar produto com estoque inicial e campos personalizados
  await page.getByRole("button", { name: "Novo produto" }).click();
  await page.fill("#sku", SKU.toLowerCase());
  await page.fill("#name", `Produto E2E ${RUN}`);
  await page.fill("#category", "Testes");
  await page.fill("#salePrice", "10,00");
  await page.fill("#minStock", "5");
  await page.fill("#initialQty", "10");
  await page.fill("#initialCost", "4,00");
  await page.fill("#custom-vencimento", "2027-12-31");
  const fieldKey = sql(`SELECT key FROM "CustomFieldDefinition" WHERE label = '${FIELD}'`);
  await page.selectOption(`#custom-${fieldKey}`, "Azul");
  await page.getByRole("button", { name: "Cadastrar produto" }).click();
  check("cadastra produto", (await toastText(page, /cadastrado/)).includes("cadastrado"));

  await page.fill('input[aria-label="Buscar produtos"]', SKU);
  await page.waitForTimeout(300);
  let row = rowOf(page, SKU);
  let rowText = (await row.textContent()) ?? "";
  check("SKU salvo em maiúsculas", rowText.includes(SKU), rowText);
  check("valor do campo novo na linha", rowText.includes("Azul"));
  check("vencimento formatado", rowText.includes("31/12/2027"));
  check("custo médio inicial R$ 4,00 e estoque 10", (await cell(page, SKU, "Custo médio")) === "R$ 4,00" && (await cell(page, SKU, "Estoque")) === "10", `${await cell(page, SKU, "Custo médio")} / ${await cell(page, SKU, "Estoque")}`);
  check("margem calculada (60%)", rowText.includes("60%"), rowText);

  // 5. Entrada de estoque recalcula custo médio: (10×4 + 10×6) / 20 = 5
  await row.getByRole("button", { name: /Ações de/ }).click();
  await page.getByRole("menuitem", { name: "Entrada de estoque" }).click();
  await page.fill("#entry-qty", "10");
  await page.fill("#entry-cost", "6,00");
  const preview = norm(await page.locator("[role=dialog] p.rounded-md").textContent());
  check("prévia do novo custo médio", preview.includes("R$ 5,00"), preview);
  await page.getByRole("button", { name: "Registrar entrada" }).click();
  await toastText(page, /Entrada registrada/);
  await page.waitForTimeout(800);
  rowText = (await rowOf(page, SKU).textContent()) ?? "";
  check("entrada: custo médio R$ 5,00 e estoque 20", (await cell(page, SKU, "Custo médio")) === "R$ 5,00" && (await cell(page, SKU, "Estoque")) === "20", `${await cell(page, SKU, "Custo médio")} / ${await cell(page, SKU, "Estoque")}`);

  // 6. Perda gera despesa = 2 × 5,00
  await rowOf(page, SKU).getByRole("button", { name: /Ações de/ }).click();
  await page.getByRole("menuitem", { name: "Ajustar estoque" }).click();
  await page.fill("#adj-qty", "2");
  await page.getByRole("button", { name: "Registrar ajuste" }).click();
  const t6 = await toastText(page, /Ajuste registrado/);
  check("perda avisa despesa de R$ 10,00", t6.includes("R$ 10,00"), t6);
  const ledger = sql(`SELECT amount FROM "LedgerEntry" WHERE description LIKE '%E2E ${RUN}%'`);
  check("despesa gravada no livro-razão", ledger === "-10.00", ledger);
  await page.waitForTimeout(800);
  rowText = (await rowOf(page, SKU).textContent()) ?? "";
  check("estoque 18 após perda", (await cell(page, SKU, "Estoque")) === "18", await cell(page, SKU, "Estoque"));

  // 7. Estoque negativo bloqueado
  await rowOf(page, SKU).getByRole("button", { name: /Ações de/ }).click();
  await page.getByRole("menuitem", { name: "Ajustar estoque" }).click();
  await page.fill("#adj-qty", "500");
  await page.getByRole("button", { name: "Registrar ajuste" }).click();
  const t7 = await toastText(page, /insuficiente/);
  check("bloqueia baixa maior que o estoque", t7.includes("insuficiente"), t7);
  await page.keyboard.press("Escape");

  // 8. Histórico na linha expandida
  await rowOf(page, SKU).getByRole("button", { name: "Ver detalhes" }).click();
  await page.waitForTimeout(1000);
  const details = (await page.locator("section[aria-label='Últimas movimentações']").textContent()) ?? "";
  check("histórico mostra entradas e ajuste", (details.match(/Entrada/g) ?? []).length === 2 && details.includes("Ajuste") && details.includes("Perda"), details.slice(0, 160));
  await page.screenshot({ path: `${OUT}/f1-admin-produto.png` });

  // 9. SKU duplicado mostra erro no campo
  await page.getByRole("button", { name: "Novo produto" }).click();
  await page.fill("#sku", SKU);
  await page.fill("#name", "Duplicado");
  await page.fill("#salePrice", "1");
  await page.getByRole("button", { name: "Cadastrar produto" }).click();
  const skuErr = await page.locator("#sku-error").textContent({ timeout: 10000 }).catch(() => "");
  check("SKU duplicado mostra erro no campo", (skuErr ?? "").includes("SKU já cadastrado"), skuErr ?? "");
  // Preço inválido
  await page.fill("#sku", `${SKU}-X`);
  await page.fill("#salePrice", "abc");
  await page.getByRole("button", { name: "Cadastrar produto" }).click();
  const priceErr = await page.locator("#salePrice-error").textContent({ timeout: 10000 }).catch(() => "");
  check("preço inválido mostra erro", (priceErr ?? "").includes("inválido"), priceErr ?? "");
  await page.keyboard.press("Escape");

  // 10. Ocultar coluna persiste após recarregar
  await page.getByRole("button", { name: /Colunas/ }).click();
  await page.getByRole("menuitemcheckbox", { name: FIELD }).click();
  await page.keyboard.press("Escape");
  check("ocultar coluna remove da tabela", !(await headers(page)).includes(FIELD));
  await page.waitForTimeout(1500); // salvamento com debounce
  await page.reload();
  await page.waitForSelector("tbody tr");
  check("coluna oculta continua oculta após recarregar", !(await headers(page)).includes(FIELD), (await headers(page)).join(" | "));

  // 11. Filtro de estoque baixo
  await page.getByRole("button", { name: /Estoque baixo/ }).click();
  const lowRows = await page.locator("tbody tr").count();
  const badges = await page.locator("tbody tr", { hasText: /Baixo|Zerado/ }).count();
  check("filtro estoque baixo só mostra alertas", lowRows > 0 && lowRows === badges, `${lowRows} linhas, ${badges} com alerta`);
  await ctx.close();
}

// ── VENDEDOR ─────────────────────────────────────────────
await wait(11000); // limite de 3 logins / 10 s
{
  const { ctx, page } = await login(browser, "vendedor");
  await page.goto(`${BASE}/produtos`);
  await page.waitForSelector("tbody tr");
  const h = await headers(page);
  check("vendedor não vê custo nem margem", !h.includes("Custo médio") && !h.includes("Margem"), h.join(" | "));
  check("vendedor sem botão Novo produto", (await page.getByRole("button", { name: "Novo produto" }).count()) === 0);
  check("vendedor sem menu de ações", (await page.getByRole("button", { name: /Ações de/ }).count()) === 0);
  check("vendedor sem link de campos", (await page.getByRole("link", { name: "Campos personalizados" }).count()) === 0);
  const html = await page.content();
  check("custo nem chega ao navegador do vendedor", !html.includes('"avgCost"') && !html.includes("avgCost\\\""), "procura avgCost no HTML/RSC");
  await page.fill('input[aria-label="Buscar produtos"]', SKU);
  await page.waitForTimeout(300);
  await rowOf(page, SKU).getByRole("button", { name: "Ver detalhes" }).click();
  await page.waitForTimeout(1000);
  const det = (await page.locator("section[aria-label='Últimas movimentações']").textContent()) ?? "";
  check("histórico do vendedor sem custo unitário", !det.includes("Custo un.") && !det.includes("R$"), det.slice(0, 120));
  await page.screenshot({ path: `${OUT}/f1-vendedor.png` });
  await page.goto(`${BASE}/produtos/campos`);
  check("vendedor bloqueado em /produtos/campos", page.url().endsWith("/sem-acesso"), page.url());
  await ctx.close();
}

await browser.close();
console.log(`\n${results.filter((r) => r.startsWith("PASS")).length}/${results.length} passaram`);

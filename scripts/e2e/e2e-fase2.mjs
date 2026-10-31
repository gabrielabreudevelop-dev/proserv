// E2E da Fase 2: refaz a planilha de conferência pela interface e confere a DRE na tela.
import { createRequire } from "node:module";
import { execSync } from "node:child_process";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = "http://localhost:3000";
const OUT = process.argv[2];
const RUN = Date.now().toString(36).slice(-4).toUpperCase();
const sql = (q) => execSync(`su postgres -c "psql -d proserv -tAc \\"${q.replace(/"/g, '\\\\\\"')}\\""`).toString().trim();
const results = [];
const check = (name, ok, extra = "") => {
  const line = `${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`;
  results.push(line);
  console.log(line);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const norm = (t) => (t ?? "").replace(/\u00a0/g, " ").trim();
const brl = (t) => {
  const s = norm(t);
  const neg = s.startsWith("-");
  const n = Number(s.replace(/[^\d,]/g, "").replace(",", "."));
  return neg ? -n : n;
};
const near = (a, b) => Math.abs(a - b) < 0.005;

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
const toast = async (page, re) => {
  const t = page.locator("[data-sonner-toast]", { hasText: re }).first();
  await t.waitFor({ timeout: 10000 }).catch(() => {});
  return norm((await t.count()) ? await t.textContent() : (await page.locator("[data-sonner-toast]").allTextContents()).join(" || "));
};

async function readDre(page) {
  await page.goto(`${BASE}/financeiro`);
  const rows = await page.locator("section[aria-labelledby='dre-title'] tr").all();
  const out = {};
  for (const r of rows) {
    const [label, value] = await r.locator("td").allTextContents();
    out[norm(label)] = brl(value);
  }
  return out;
}

async function newProduct(page, { sku, name, price, qty, cost }) {
  await page.goto(`${BASE}/produtos`);
  await page.getByRole("button", { name: "Novo produto" }).click();
  await page.fill("#sku", sku);
  await page.fill("#name", name);
  await page.fill("#salePrice", price);
  await page.fill("#initialQty", qty);
  await page.fill("#initialCost", cost);
  await page.getByRole("button", { name: "Cadastrar produto" }).click();
  await toast(page, /cadastrado/);
}

async function sell(page, items, { discount, payment }) {
  await page.goto(`${BASE}/vendas/nova`);
  for (const [sku, qty] of items) {
    await page.fill('input[aria-label="Buscar produto"]', sku);
    for (let i = 0; i < qty; i++) await page.keyboard.press("Enter");
    // Enter limpa a busca; repete a busca para adicionar mais unidades
    if (qty > 1) {
      /* quantidades adicionais já entraram porque cada Enter refaz a busca vazia → primeiro resultado da lista */
    }
  }
  return { discount, payment };
}

const browser = await chromium.launch();
const A = `E2A-${RUN}`;
const B = `E2B-${RUN}`;

// ── ADMIN: cenário da planilha ───────────────────────────
{
  const { ctx, page } = await login(browser, "admin");
  const before = await readDre(page);

  await newProduct(page, { sku: A, name: `Conferência A ${RUN}`, price: "10,00", qty: "10", cost: "4,00" });
  await newProduct(page, { sku: B, name: `Conferência B ${RUN}`, price: "50,00", qty: "5", cost: "20,00" });

  // Entrada A: 10 a 6,00 → custo médio 5,00
  await page.fill('input[aria-label="Buscar produtos"]', A);
  await page.locator("tbody tr", { hasText: A }).getByRole("button", { name: /Ações de/ }).click();
  await page.getByRole("menuitem", { name: "Entrada de estoque" }).click();
  await page.fill("#entry-qty", "10");
  await page.fill("#entry-cost", "6,00");
  await page.getByRole("button", { name: "Registrar entrada" }).click();
  await toast(page, /Entrada registrada/);
  check("custo médio de A = 5,00", sql(`SELECT "avgCost" FROM "Product" WHERE sku='${A}'`) === "5.0000");

  // PDV: monta o carrinho pela busca + quantidade digitada
  async function pdvSale(items, discount, payment) {
    await page.goto(`${BASE}/vendas/nova`);
    for (const [sku, qty] of items) {
      await page.fill('input[aria-label="Buscar produto"]', sku);
      await page.keyboard.press("Enter");
      const name = sku === A ? `Conferência A ${RUN}` : `Conferência B ${RUN}`;
      await page.fill(`input[aria-label="Quantidade de ${name}"]`, String(qty));
    }
    if (discount) await page.fill("#pdv-discount", discount);
    await page.getByRole("button", { name: payment, exact: true }).click();
    await page.keyboard.press("Control+Enter");
    const t = await toast(page, /Venda nº/);
    const m = /Venda nº (\d+) registrada · (R\$ [\d.,]+)/.exec(t);
    return { number: m?.[1], total: m ? brl(m[2]) : NaN, text: t };
  }

  const v1 = await pdvSale([[A, 3], [B, 1]], "5", "Pix");
  check("venda 1: total 75,00 (80 − 5 de desconto)", near(v1.total, 75), v1.text);
  await page.screenshot({ path: `${OUT}/f2-pdv-apos-venda.png` });
  check("carrinho limpo após a venda", (await page.getByText("Nenhum item.").count()) === 1);

  const v2 = await pdvSale([[A, 2]], "", "Dinheiro");
  check("venda 2: total 20,00", near(v2.total, 20), v2.text);
  const v3 = await pdvSale([[B, 2]], "", "Cartão de crédito");
  check("venda 3: total 100,00", near(v3.total, 100), v3.text);

  // PDV recusa além do estoque (B tem 2)
  await page.fill('input[aria-label="Buscar produto"]', B);
  await page.keyboard.press("Enter");
  await page.fill(`input[aria-label="Quantidade de Conferência B ${RUN}"]`, "3");
  await page.getByRole("button", { name: "Pix", exact: true }).click();
  check("PDV bloqueia quantidade acima do estoque", await page.getByRole("button", { name: "Finalizar venda" }).isDisabled());
  check("PDV mostra o máximo disponível", (await page.getByText("Máx. 2").count()) === 1);

  // Cancela a venda 3
  await page.goto(`${BASE}/vendas`);
  await page.getByRole("button", { name: `Cancelar venda ${v3.number}` }).click();
  await page.fill("#cancel-reason", "Cliente desistiu");
  await page.getByRole("button", { name: "Cancelar venda", exact: true }).click();
  const tc = await toast(page, /cancelada/);
  check("cancela a venda 3", tc.includes(`nº ${v3.number}`), tc);
  check("B volta ao estoque (2 + 2 = 4)", sql(`SELECT "stockQty" FROM "Product" WHERE sku='${B}'`) === "4.000");

  // Perda de 1 A
  await page.goto(`${BASE}/produtos`);
  await page.fill('input[aria-label="Buscar produtos"]', A);
  await page.locator("tbody tr", { hasText: A }).getByRole("button", { name: /Ações de/ }).click();
  await page.getByRole("menuitem", { name: "Ajustar estoque" }).click();
  await page.fill("#adj-qty", "1");
  await page.getByRole("button", { name: "Registrar ajuste" }).click();
  await toast(page, /Ajuste registrado/);

  // Despesas
  async function expense(amount, category, description) {
    await page.goto(`${BASE}/financeiro`);
    await page.getByRole("button", { name: "Lançar despesa" }).click();
    await page.fill("#exp-amount", amount);
    await page.selectOption("#exp-category", category);
    await page.fill("#exp-description", description);
    await page.getByRole("dialog").getByRole("button", { name: "Lançar despesa" }).click();
    return toast(page, /lançada/);
  }
  await expense("30,00", "Aluguel", `Aluguel ${RUN}`);
  await expense("12,50", "Energia", `Energia ${RUN}`);
  await expense("9,90", "Internet e telefone", `Engano ${RUN}`);
  await page.reload();
  await page.getByRole("button", { name: `Estornar Engano ${RUN}` }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Estornar" }).click();
  check("estorna despesa lançada por engano", (await toast(page, /estornada/)).includes("estornada"));

  // Confere a DRE na tela: diferença antes/depois = planilha
  const after = await readDre(page);
  const delta = (k) => Math.round((after[k] - before[k]) * 100) / 100;
  const expected = {
    "Receita de produtos": 195,
    "(−) Cancelamentos": -100,
    "Receita líquida": 95,
    "(−) Custo das mercadorias vendidas": -45,
    "Lucro bruto": 50,
    "(−) Despesas": -47.5,
  };
  for (const [k, v] of Object.entries(expected)) check(`DRE: ${k} variou ${v}`, near(delta(k), v), `antes ${before[k]} · depois ${after[k]}`);
  const resKey = Object.keys(after).find((k) => k === "Lucro" || k === "Prejuízo");
  const resBeforeKey = Object.keys(before).find((k) => k === "Lucro" || k === "Prejuízo");
  const resDelta = Math.round((after[resKey] - before[resBeforeKey]) * 100) / 100;
  check("DRE: resultado variou +2,50 (planilha)", near(resDelta, 2.5), `antes ${before[resBeforeKey]} · depois ${after[resKey]}`);
  check("DRE fecha: líquida − CMV − despesas = resultado", near(after["Receita líquida"] + after["(−) Custo das mercadorias vendidas"] + after["(−) Despesas"], after[resKey]));
  await page.screenshot({ path: `${OUT}/f2-financeiro.png`, fullPage: false });
  check("estoque final A = 14 (20 − 3 − 2 − 1)", sql(`SELECT "stockQty" FROM "Product" WHERE sku='${A}'`) === "14.000");
  await ctx.close();
}

// ── VENDEDOR ─────────────────────────────────────────────
await wait(11000);
{
  const { ctx, page } = await login(browser, "vendedor");
  await page.goto(`${BASE}/vendas`);
  check("vendedor vê 'Minhas vendas'", (await page.locator("h1").textContent()) === "Minhas vendas");
  const heads = (await page.locator("thead th").allTextContents()).map(norm);
  check("vendedor sem coluna de vendedor", !heads.includes("Vendedor"), heads.join(" | "));
  check("vendedor não vê vendas do admin", (await page.getByText(`#${"" }`).count()) >= 0 && !(await page.content()).includes("Conferência A " + RUN));
  check("vendedor sem botão Cancelar", (await page.getByRole("button", { name: /Cancelar venda/ }).count()) === 0);
  check("vendedor sem KPI de lucro", (await page.getByText("Lucro bruto das vendas").count()) === 0);
  await page.getByRole("button", { name: /Ver itens da venda/ }).first().click();
  const det = norm(await page.locator("tbody tr.bg-muted\\/30").first().textContent());
  check("detalhe da venda sem custo para vendedor", !det.includes("Custo") && !det.includes("Lucro"), det.slice(0, 120));
  const own = sql(`SELECT count(*) FROM "Sale" s JOIN "user" u ON u.id = s."sellerId" WHERE u.email='vendedor@proserv.local' AND s."createdAt" >= date_trunc('month', now() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'`);
  // Só as linhas da tabela principal (a linha expandida tem uma tabela de itens dentro).
  const rows = await page.locator("[data-slot=table-body] > tr:not(.bg-muted\\/30)").count();
  check("lista do vendedor = só as vendas dele no mês", String(rows) === own, `${rows} na tela · ${own} no banco`);
  await page.goto(`${BASE}/financeiro`);
  check("vendedor bloqueado no Financeiro", page.url().endsWith("/sem-acesso"));
  await page.screenshot({ path: `${OUT}/f2-vendedor.png` });
  await ctx.close();
}

await browser.close();
console.log(`\n${results.filter((r) => r.startsWith("PASS")).length}/${results.length} passaram`);

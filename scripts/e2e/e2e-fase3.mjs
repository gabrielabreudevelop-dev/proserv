// E2E da Fase 3: serviços, agenda e dashboard.
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
const norm = (t) => (t ?? "").replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim();
const brl = (t) => {
  const s = norm(t);
  const n = Number(s.replace(/[^\d,]/g, "").replace(",", "."));
  return s.startsWith("-") ? -n : n;
};
const near = (a, b) => Math.abs(a - b) < 0.005;

// Datas locais (Brasília)
const local = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(d);
const today = local(new Date());
const addDays = (iso, n) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8) + n)).toISOString().slice(0, 10);
const notSunday = (iso, dir) => (new Date(iso + "T12:00:00Z").getUTCDay() === 0 ? addDays(iso, dir) : iso);
const future = notSunday(addDays(today, 10), 1);
const past = notSunday(addDays(today, -1), -1);

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
const kpi = async (page, label) => norm(await page.locator("div.rounded-xl.border.p-5", { has: page.getByText(label, { exact: true }) }).locator("p").nth(1).textContent());
async function dreValue(page, month, label) {
  await page.goto(`${BASE}/financeiro?mes=${month}`);
  const row = page.locator("section[aria-labelledby='dre-title'] tr", { hasText: label }).first();
  return brl(await row.locator("td").nth(1).textContent());
}

const paulo = sql(`SELECT id FROM "user" WHERE email='prestador@proserv.local'`);
const marina = sql(`SELECT id FROM "user" WHERE email='prestador2@proserv.local'`);
const SVC = `Higienização E2E ${RUN}`;
const CLIENT = `Cliente E2E ${RUN}`;
const browser = await chromium.launch();

// ── ADMIN ───────────────────────────────────────────────
{
  const { ctx, page } = await login(browser, "admin");

  // 1. Catálogo
  await page.goto(`${BASE}/servicos`);
  await page.getByRole("button", { name: "Novo serviço" }).click();
  await page.fill("#svc-name", SVC);
  await page.selectOption("#svc-duration", "45");
  await page.fill("#svc-price", "120,00");
  await page.fill("#svc-cost", "20,00");
  await page.getByRole("button", { name: "Cadastrar serviço" }).click();
  await toast(page, /cadastrado/);
  const row = norm(await page.locator("tbody tr", { hasText: SVC }).textContent());
  check("cadastra serviço com duração, valor e margem", row.includes("45 min") && row.includes("R$ 120,00") && row.includes("83,3%"), row);
  const svcId = sql(`SELECT id FROM "Service" WHERE name='${SVC}'`);

  // 2. Agenda: agendar pelo clique no horário vago
  await page.goto(`${BASE}/agenda?dia=${future}&visao=dia&prestador=${paulo}`);
  const col = page.locator("[aria-label]").filter({ hasText: "" }).locator("xpath=.").first();
  const grid = page.locator(`div.relative.border-l[aria-label="Paulo Prestador"]`);
  await grid.click({ position: { x: 40, y: 3 * 56 + 5 } }); // 10:00 (grade começa às 07:00, 56 px/h)
  check("clique no horário vago abre agendamento às 10:00", (await page.locator("#sch-time").inputValue()) === "10:00");
  await page.selectOption("#sch-service", svcId);
  await page.fill("#sch-customer", CLIENT);
  await page.fill("#sch-phone", "(11) 98888-7777");
  await page.getByRole("dialog").getByRole("button", { name: "Agendar" }).click();
  const t2 = await toast(page, /Agendado/);
  check("agenda atendimento", t2.includes("10:00"), t2);
  await page.waitForTimeout(800);
  const block = page.locator(`button[aria-label^="10:00 ${CLIENT}"]`);
  check("bloco aparece na grade às 10:00", (await block.count()) === 1);
  check("cliente novo gravado com telefone só com dígitos", sql(`SELECT phone FROM "Customer" WHERE name='${CLIENT}'`) === "11988887777");

  // 3. Choque detectado antes de enviar
  // 10:30 fica sobre o bloco 10:00–10:45 (clicar ali abre o atendimento), então usa o botão Agendar.
  await page.getByRole("button", { name: "Agendar" }).click();
  await page.fill("#sch-date", "${future}".replace("${future}", future));
  await page.selectOption("#sch-time", "10:30");
  await page.selectOption("#sch-provider", paulo);
  await page.selectOption("#sch-service", svcId);
  await page.fill("#sch-customer", `Outro ${RUN}`);
  const clash = norm(await page.getByRole("dialog").locator("[role=alert]").textContent().catch(() => ""));
  check("aviso de choque de horário no diálogo", clash.includes("Choque com") && clash.includes(CLIENT), clash);
  check("botão Agendar bloqueado no choque", await page.getByRole("dialog").getByRole("button", { name: "Agendar" }).isDisabled());
  await page.keyboard.press("Escape");

  // 4. Remarcar para 14:00
  await block.click();
  check("concluir indisponível para atendimento futuro", await page.getByRole("button", { name: "Concluir" }).isDisabled());
  await page.getByRole("button", { name: "Remarcar" }).click();
  await page.selectOption("#rs-time", "14:00");
  await page.getByRole("button", { name: "Salvar novo horário" }).click();
  await toast(page, /remarcado/);
  await page.waitForTimeout(800);
  check("remarcado para 14:00", (await page.locator(`button[aria-label^="14:00 ${CLIENT}"]`).count()) === 1);

  // 5. Concluir um atendimento de ontem com valor diferente da tabela
  const month = past.slice(0, 7);
  const recBefore = await dreValue(page, month, "Receita de serviços");
  const despBefore = await dreValue(page, month, "(−) Despesas");
  await page.goto(`${BASE}/dashboard?foco=servicos`);
  const week7Before = brl(await kpi(page, "Faturamento · 7 dias"));

  await page.goto(`${BASE}/agenda?dia=${past}&visao=dia&prestador=${marina}`);
  await page.locator(`div.relative.border-l[aria-label="Marina Técnica"]`).click({ position: { x: 40, y: 11.5 * 56 + 5 } }); // 18:30
  await page.selectOption("#sch-service", svcId);
  await page.fill("#sch-customer", CLIENT);
  check("diálogo reconhece cliente existente", norm(await page.locator("#sch-customer-hint").textContent()) === "Cliente já cadastrado");
  check("avisa que o horário já passou", (await page.getByText("esse horário já passou").count()) === 1);
  await page.getByRole("dialog").getByRole("button", { name: "Agendar" }).click();
  await toast(page, /Agendado/);
  await page.waitForTimeout(800);
  const pastBlock = page.locator(`button[aria-label^="18:30 ${CLIENT}"]`);
  check("atendimento vencido aparece como atrasado", ((await pastBlock.getAttribute("aria-label")) ?? "").includes("atrasado"));
  await pastBlock.click();
  await page.getByRole("button", { name: "Concluir" }).click();
  await page.fill("#cp-price", "130,00");
  await page.getByRole("button", { name: "Pix", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar conclusão" }).click();
  const t5 = await toast(page, /concluído/);
  check("conclui com valor cobrado de R$ 130,00", t5.includes("R$ 130,00"), t5);

  const recAfter = await dreValue(page, month, "Receita de serviços");
  const despAfter = await dreValue(page, month, "(−) Despesas");
  check("DRE: receita de serviços +130,00", near(recAfter - recBefore, 130), `${recBefore} → ${recAfter}`);
  check("DRE: custo do serviço (20,00) entra nas despesas", near(despAfter - despBefore, -20), `${despBefore} → ${despAfter}`);
  await page.goto(`${BASE}/dashboard?foco=servicos`);
  const week7After = brl(await kpi(page, "Faturamento · 7 dias"));
  check("dashboard: faturamento de 7 dias +130,00", near(week7After - week7Before, 130), `${week7Before} → ${week7After}`);

  // 6. Cancelar concluído estorna
  await page.goto(`${BASE}/agenda?dia=${past}&visao=dia&prestador=${marina}`);
  await page.locator(`button[aria-label^="18:30 ${CLIENT}"]`).click();
  await page.getByRole("button", { name: "Cancelar e estornar" }).click();
  await page.fill("#cx-reason", "Teste de estorno");
  await page.getByRole("button", { name: "Confirmar cancelamento" }).click();
  await toast(page, /estornados/);
  // O estorno entra na data de hoje; a receita líquida do mês de hoje cai 130.
  const st = sql(`SELECT status FROM "Appointment" a JOIN "Customer" c ON c.id=a."customerId" WHERE c.name='${CLIENT}' AND a."serviceId"='${svcId}' ORDER BY a."startsAt" LIMIT 1`);
  const reversals = sql(`SELECT SUM(amount) FROM "LedgerEntry" e JOIN "Appointment" a ON a.id=e."appointmentId" WHERE e.kind='ESTORNO' AND a."serviceId"='${svcId}'`);
  check("concluído cancelado gera estornos (−130 receita, +20 custo)", st === "CANCELADO" && reversals === "-110.00", `${st} · soma dos estornos ${reversals}`);

  // 7. Conferência dos números do dashboard contra o banco
  await page.goto(`${BASE}/dashboard?foco=produtos`);
  const sqlRev7 = Number(sql(`SELECT COALESCE(SUM(total),0) FROM "Sale" WHERE status='CONCLUIDA' AND "createdAt" >= (('${addDays(today, -6)}'::timestamp) + interval '3 hours') AND "createdAt" < (('${addDays(today, 1)}'::timestamp) + interval '3 hours')`));
  check("dashboard produtos: faturamento 7 dias = banco", near(brl(await kpi(page, "Faturamento · 7 dias")), sqlRev7), `tela ${await kpi(page, "Faturamento · 7 dias")} · banco ${sqlRev7}`);
  const sqlLow = sql(`SELECT COUNT(*) FROM "Product" WHERE active AND ("stockQty" <= 0 OR ("minStock" IS NOT NULL AND "stockQty" <= "minStock"))`);
  check("dashboard produtos: estoque baixo = banco", (await kpi(page, "Estoque baixo")) === sqlLow, `${await kpi(page, "Estoque baixo")} · ${sqlLow}`);
  await page.goto(`${BASE}/dashboard?foco=servicos`);
  const sqlToday = sql(`SELECT COUNT(*) FROM "Appointment" WHERE status <> 'CANCELADO' AND "startsAt" >= (('${today}'::timestamp) + interval '3 hours') AND "startsAt" < (('${addDays(today, 1)}'::timestamp) + interval '3 hours')`);
  check("dashboard serviços: atendimentos hoje = banco", (await kpi(page, "Atendimentos hoje")) === sqlToday, `${await kpi(page, "Atendimentos hoje")} · ${sqlToday}`);
  const sqlOverdue = sql(`SELECT COUNT(*) FROM "Appointment" WHERE status IN ('AGENDADO','EM_ANDAMENTO') AND "endsAt" < now() AT TIME ZONE 'UTC'`);
  const pendHint = norm(await page.locator("div.rounded-xl.border.p-5", { has: page.getByText("Taxa de conclusão · 7 dias") }).locator("p").nth(2).textContent());
  check("dashboard serviços: pendentes = banco", pendHint.startsWith(`${sqlOverdue} `) || (sqlOverdue === "0" && pendHint === "Nenhum pendente"), `${pendHint} · banco ${sqlOverdue}`);
  await page.screenshot({ path: `${OUT}/f3-dash-servicos.png`, fullPage: true });

  // 8. Visão padrão
  await page.getByRole("button", { name: "Definir como padrão" }).click();
  await toast(page, /abre por padrão/);
  await page.goto(`${BASE}/dashboard`);
  check("visão padrão salva: /dashboard abre em Serviços", (await page.getByText("serviços e agenda da equipe").count()) === 1);
  await page.goto(`${BASE}/dashboard?foco=produtos`);
  await page.getByRole("button", { name: "Definir como padrão" }).click();
  await toast(page, /abre por padrão/);
  await ctx.close();
}

// ── PRESTADOR (Paulo) ───────────────────────────────────
await wait(11000);
{
  const { ctx, page } = await login(browser, "prestador");
  await page.goto(`${BASE}/agenda?visao=semana&prestador=${marina}`);
  check("prestador vê 'Minha agenda'", (await page.locator("h1").textContent()) === "Minha agenda");
  const labels = await page.locator("button[aria-label*=', ']").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label")).filter((l) => /\d\d:\d\d /.test(l)));
  check("tentativa de ver agenda da Marina pela URL é ignorada", labels.length > 0 && labels.every((l) => l.includes("Paulo Prestador")), `${labels.length} blocos`);
  check("prestador sem botão Agendar nem filtro", (await page.getByRole("button", { name: "Agendar" }).count()) === 0 && (await page.getByLabel("Filtrar por prestador").count()) === 0);
  await page.goto(`${BASE}/agenda`);
  await page.locator("div.relative.border-l").first().click({ position: { x: 30, y: 12 * 56 + 5 } });
  check("clique em horário vago não abre agendamento", (await page.getByRole("dialog").count()) === 0);
  await page.goto(`${BASE}/agenda?visao=semana&dia=${addDays(today, 7)}`);
  const own = page.locator("button[aria-label*='Paulo Prestador, Agendado']").first();
  const hasOwn = (await own.count()) > 0;
  check("há atendimento futuro do prestador para testar", hasOwn);
  if (hasOwn) {
    await own.click();
    check("prestador vê Concluir (bloqueado até 1 h antes) e não vê Remarcar", (await page.getByRole("button", { name: "Concluir" }).count()) === 1 && (await page.getByRole("button", { name: "Concluir" }).isDisabled()) && (await page.getByRole("button", { name: "Remarcar" }).count()) === 0);
    await page.keyboard.press("Escape");
  }
  await page.goto(`${BASE}/dashboard`);
  check("dashboard do prestador sem valores em reais", !(await page.locator("main").textContent()).includes("R$"));
  check("dashboard do prestador sem alternância Produtos", (await page.getByRole("tablist", { name: "Foco do dashboard" }).count()) === 0);
  await page.screenshot({ path: `${OUT}/f3-prestador-dash.png` });
  await page.goto(`${BASE}/servicos`);
  const heads = (await page.locator("thead th").allTextContents()).map(norm);
  check("prestador vê serviços sem custo e sem cadastro", !heads.includes("Custo estimado") && (await page.getByRole("button", { name: "Novo serviço" }).count()) === 0, heads.join(" | "));
  await page.goto(`${BASE}/produtos`);
  check("prestador bloqueado em Produtos", page.url().endsWith("/sem-acesso"));
  await ctx.close();
}

await browser.close();
console.log(`\n${results.filter((r) => r.startsWith("PASS")).length}/${results.length} passaram`);

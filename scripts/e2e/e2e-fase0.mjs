// Verificação E2E da Fase 0: login real por cargo, menu, bloqueios e erros.
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");

const BASE = "http://localhost:3000";
const OUT = process.argv[2];
const ROLES = {
  admin: { menu: ["Dashboard", "Produtos", "Vendas", "Serviços", "Agenda", "Financeiro", "Usuários"], blocked: [] },
  gerente: { menu: ["Dashboard", "Produtos", "Vendas", "Serviços", "Agenda", "Financeiro"], blocked: ["/config/usuarios"] },
  vendedor: { menu: ["Dashboard", "Produtos", "Vendas"], blocked: ["/financeiro", "/agenda", "/config/usuarios"] },
  prestador: { menu: ["Dashboard", "Serviços", "Agenda"], blocked: ["/produtos", "/vendas", "/financeiro"] },
};

const results = [];
const check = (name, ok, extra = "") => { const l = `${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`; results.push(l); console.log(l); };

const browser = await chromium.launch();

// Senha errada
{
  const page = await browser.newPage();
  await page.goto(`${BASE}/login`);
  await page.fill("#email", "admin@proserv.local");
  await page.fill("#password", "senha-errada");
  await page.click("button[type=submit]");
  const alert = await page.locator("form [role=alert]").textContent({ timeout: 10000 }).catch(() => null);
  check("senha errada mostra erro", alert?.includes("incorretos"), alert ?? "sem alerta");
  await page.close();
}

for (const [role, spec] of Object.entries(ROLES)) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/dashboard`);
  check(`${role}: sem sessão vai para /login`, page.url().includes("/login?voltar=%2Fdashboard"));

  await new Promise((r) => setTimeout(r, 11000));
  await page.fill("#email", `${role}@proserv.local`);
  await page.fill("#password", "proserv123");
  await page.click("button[type=submit]");
  await page.waitForURL("**/dashboard", { timeout: 15000 }).catch(() => {});
  check(`${role}: login leva ao dashboard`, page.url().endsWith("/dashboard"), page.url());

  const menu = (await page.locator("aside nav a").allTextContents()).map((t) => t.trim());
  check(`${role}: menu correto`, JSON.stringify(menu) === JSON.stringify(spec.menu), menu.join(", "));

  for (const path of spec.blocked) {
    await page.goto(`${BASE}${path}`);
    check(`${role}: ${path} bloqueado`, page.url().endsWith("/sem-acesso"), page.url());
  }

  if (role === "admin") {
    await page.goto(`${BASE}/dashboard`);
    await page.screenshot({ path: `${OUT}/admin-dashboard.png` });
    await page.goto(`${BASE}/config/usuarios`);
    const rows = await page.locator("tbody tr").count();
    const { execSync } = await import("node:child_process");
    const dbUsers = Number(execSync(`su postgres -c "psql -d proserv -tAc 'select count(*) from \\"user\\"'"`).toString().trim());
    check("admin: lista todos os usuários do banco", rows === dbUsers, `${rows} linhas · ${dbUsers} no banco`);
    await page.screenshot({ path: `${OUT}/admin-usuarios.png` });
    // alternância Produtos/Serviços
    await page.goto(`${BASE}/dashboard?foco=servicos`);
    const desc = await page.locator("main p").first().textContent();
    check("admin: foco serviços muda o dashboard", desc?.includes("serviços"), desc ?? "");
  }
  if (role === "prestador") {
    await page.goto(`${BASE}/dashboard`);
    const switchCount = await page.locator("[role=tablist]").count();
    const desc = await page.locator("main p").first().textContent();
    check("prestador: sem seletor e dashboard de serviços", switchCount === 0 && desc?.includes("serviços"), desc ?? "");
    await page.goto(`${BASE}/dashboard`);
    await page.screenshot({ path: `${OUT}/prestador-dashboard.png` });
  }
  if (role === "vendedor") {
    await page.goto(`${BASE}/financeiro`);
    await page.screenshot({ path: `${OUT}/vendedor-sem-acesso.png` });
  }

  // logout
  await page.goto(`${BASE}/dashboard`);
  await page.locator("header").getByRole("button").last().click({ timeout: 10000 }).catch(async (e) => {
    await page.screenshot({ path: `${OUT}/fail-${role}.png` }); console.log("logout click falhou em", page.url()); throw e; });
  await page.getByRole("menuitem", { name: "Sair" }).click();
  await page.waitForURL("**/login**", { timeout: 10000 }).catch(() => {});
  check(`${role}: logout volta ao login`, page.url().includes("/login"), page.url());
  await ctx.close();
}

// Limite de tentativas: 4 senhas erradas seguidas
{
  await new Promise((r) => setTimeout(r, 11000));
  const page = await browser.newPage();
  await page.goto(`${BASE}/login`);
  let last = "";
  for (let i = 0; i < 4; i++) {
    await page.fill("#email", "gerente@proserv.local");
    await page.fill("#password", "senha-errada");
    await page.click("button[type=submit]");
    await page.waitForTimeout(800);
    last = (await page.locator("form [role=alert]").textContent()) ?? "";
  }
  check("4ª tentativa seguida avisa sobre limite", last.includes("Muitas tentativas"), last);
  await page.close();
}

const login = await browser.newContext();
const lp = await login.newPage();
await lp.goto(`${BASE}/login`);
await lp.screenshot({ path: `${OUT}/login.png` });

await browser.close();
console.log(`\n${results.filter((r) => r.startsWith("PASS")).length}/${results.length} passaram`);

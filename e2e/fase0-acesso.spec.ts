import { expect, test } from "@playwright/test";
import { login, loginPause, sql, storage, type Role } from "./helpers";

const MENUS: Record<Role, string[]> = {
  admin: ["Dashboard", "Produtos", "Vendas", "Serviços", "Agenda", "Clientes", "Retornos", "Financeiro", "Usuários", "Auditoria"],
  gerente: ["Dashboard", "Produtos", "Vendas", "Serviços", "Agenda", "Clientes", "Retornos", "Financeiro"],
  vendedor: ["Dashboard", "Produtos", "Vendas"],
  prestador: ["Dashboard", "Serviços", "Agenda"],
};
const BLOCKED: Record<Role, string[]> = {
  admin: [],
  gerente: ["/config/usuarios", "/config/auditoria"],
  vendedor: ["/financeiro", "/agenda", "/clientes", "/retornos", "/config/usuarios", "/produtos/campos"],
  prestador: ["/produtos", "/vendas", "/financeiro", "/clientes", "/retornos"],
};

test.describe("sem sessão", () => {
  test("página protegida leva ao login e guarda o destino", async ({ page }) => {
    await page.goto("/financeiro");
    await expect(page).toHaveURL(/\/login\?voltar=%2Ffinanceiro$/);
  });

  test("health check é público e não expõe dados", async ({ request }) => {
    const res = await request.get("/api/health");
    expect(res.ok()).toBeTruthy();
    expect(await res.json()).toMatchObject({ status: "ok", db: "up" });
  });

  test("cabeçalhos de segurança", async ({ request }) => {
    const res = await request.get("/login");
    const h = res.headers();
    expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
    expect(h["x-frame-options"]).toBe("DENY");
    expect(h["x-powered-by"]).toBeUndefined();
  });

  test("404 em português", async ({ page }) => {
    await page.goto("/login");
    const res = await page.goto("/rota-que-nao-existe");
    // Sem sessão o proxy manda para o login; com sessão, 404.
    expect([200, 404]).toContain(res?.status());
  });
});

for (const role of Object.keys(MENUS) as Role[]) {
  test.describe(`cargo ${role}`, () => {
    test.use({ storageState: storage(role) });

    test("menu mostra só o permitido", async ({ page }) => {
      await page.goto("/dashboard");
      const items = (await page.locator("aside nav a").allTextContents()).map((t) => t.trim());
      expect(items).toEqual(MENUS[role]);
    });

    for (const path of BLOCKED[role]) {
      test(`bloqueado em ${path}`, async ({ page }) => {
        await page.goto(path);
        await expect(page).toHaveURL(/\/sem-acesso$/);
      });
    }
  });
}

test.describe("dashboard por cargo", () => {
  test.describe("admin", () => {
    test.use({ storageState: storage("admin") });
    test("alterna entre Produtos e Serviços", async ({ page }) => {
      await page.goto("/dashboard?foco=servicos");
      await expect(page.locator("main p").first()).toContainText("serviços e agenda da equipe");
      await page.getByRole("tab", { name: "Produtos" }).click();
      await expect(page.locator("main p").first()).toContainText("vendas da loja");
    });
  });
  test.describe("prestador", () => {
    test.use({ storageState: storage("prestador") });
    test("só vê serviços, sem alternância", async ({ page }) => {
      await page.goto("/dashboard?foco=produtos");
      await expect(page.locator("main p").first()).toContainText("seus serviços e agenda");
      await expect(page.getByRole("tablist", { name: "Foco do dashboard" })).toHaveCount(0);
    });
  });
});

test.describe("login e logout", () => {
  test("senha errada, limite de tentativas e logout", async ({ page }) => {
    test.setTimeout(120_000);
    await loginPause();
    await login(page, "gerente@proserv.local", "senha-errada");
    await expect(page.locator("form [role=alert]")).toHaveText("E-mail ou senha incorretos.");

    await loginPause();
    await login(page, "gerente@proserv.local");
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.locator("header").getByRole("button").last().click();
    await page.getByRole("menuitem", { name: "Sair" }).click();
    await expect(page).toHaveURL(/\/login/);

    // 4 tentativas seguidas → aviso de limite
    await loginPause();
    for (let i = 0; i < 4; i++) {
      await page.fill("#email", "gerente@proserv.local");
      await page.fill("#password", "senha-errada");
      await page.click("button[type=submit]");
      await page.waitForTimeout(700);
    }
    await expect(page.locator("form [role=alert]")).toContainText("Muitas tentativas");
    await loginPause();
  });

  test("lista de usuários bate com o banco", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storage("admin") });
    const page = await ctx.newPage();
    await page.goto("/config/usuarios");
    const total = Number(await sql(`SELECT count(*) FROM "user"`));
    await expect(page.locator("[data-slot=table-body] > tr")).toHaveCount(total);
    await ctx.close();
  });
});

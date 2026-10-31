import { expect, test } from "@playwright/test";
import { login, loginPause, norm, runId, sql, storage, toast } from "./helpers";

const RUN = runId();
const EMAIL = `novo.${RUN.toLowerCase()}@proserv.local`;
const NAME = `Novo Vendedor ${RUN}`;

test.describe.serial("gestão de usuários", () => {
  let tempPassword = "";

  test("admin cria usuário e recebe senha provisória", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storage("admin") });
    const page = await ctx.newPage();
    await page.goto("/config/usuarios");
    await page.getByRole("button", { name: "Novo usuário" }).click();
    await page.fill("#nu-name", NAME);
    await page.fill("#nu-email", EMAIL);
    await page.getByRole("button", { name: "Criar usuário" }).click();
    tempPassword = norm(await page.getByTestId("temp-password").textContent());
    expect(tempPassword).toMatch(/^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/);
    await page.getByRole("button", { name: "Pronto" }).click();
    await expect(page.locator("tbody tr", { hasText: NAME })).toContainText("Vendedor");
    await ctx.close();
  });

  test("novo usuário entra, vê o menu do cargo e troca a senha", async ({ page }) => {
    await loginPause();
    await login(page, EMAIL, tempPassword);
    await expect(page).toHaveURL(/\/dashboard$/);
    expect((await page.locator("aside nav a").allTextContents()).map((t) => t.trim())).toEqual(["Dashboard", "Produtos", "Vendas"]);
    await page.goto("/conta");
    await page.fill("#pw-current", tempPassword);
    await page.fill("#pw-next", "senha-nova-123");
    await page.fill("#pw-confirm", "senha-nova-123");
    await page.getByRole("button", { name: "Trocar senha" }).click();
    await toast(page, /Senha trocada/);
  });

  test("não deixa o admin remover o próprio cargo nem bloquear a si mesmo", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storage("admin") });
    const page = await ctx.newPage();
    await page.goto("/config/usuarios");
    const me = page.locator("tbody tr", { hasText: "(você)" });
    await me.getByRole("button", { name: /Ações de/ }).click();
    await expect(page.getByRole("menuitem", { name: "Bloquear acesso" })).toHaveCount(0);
    await page.getByRole("menuitem", { name: "Alterar cargo" }).click();
    await expect(page.getByRole("dialog").getByRole("checkbox").first()).toBeDisabled(); // admin
    await page.keyboard.press("Escape");
    await ctx.close();
  });

  test("alterar cargo e bloquear: sai na hora e não entra mais", async ({ browser }) => {
    // sessão do usuário novo
    await loginPause();
    const userCtx = await browser.newContext();
    const userPage = await userCtx.newPage();
    await login(userPage, EMAIL, "senha-nova-123");
    await expect(userPage).toHaveURL(/\/dashboard$/);

    const adminCtx = await browser.newContext({ storageState: storage("admin") });
    const admin = await adminCtx.newPage();
    await admin.goto("/config/usuarios");
    const row = admin.locator("tbody tr", { hasText: NAME });
    await row.getByRole("button", { name: /Ações de/ }).click();
    await admin.getByRole("menuitem", { name: "Alterar cargo" }).click();
    await admin.getByRole("dialog").getByText("Prestador", { exact: true }).click();
    await admin.getByRole("dialog").getByRole("button", { name: "Salvar" }).click();
    await toast(admin, /atualizado/);
    expect(await sql(`SELECT role FROM "user" WHERE email = $1`, [EMAIL])).toBe("vendedor,prestador");

    await row.getByRole("button", { name: /Ações de/ }).click();
    await admin.getByRole("menuitem", { name: "Bloquear acesso" }).click();
    await admin.fill("#bl-reason", "Teste E2E");
    await admin.getByRole("button", { name: "Bloquear acesso" }).click();
    await toast(admin, /bloqueado/);
    await expect(row).toContainText("Bloqueado");

    await userPage.goto("/dashboard");
    await expect(userPage).toHaveURL(/\/login/);
    await loginPause();
    await login(userPage, EMAIL, "senha-nova-123");
    await expect(userPage.locator("form [role=alert]")).toContainText(/bloqueado|incorretos/);

    await admin.goto(`/config/auditoria?q=${encodeURIComponent(NAME)}`);
    const log = norm(await admin.locator("main table").textContent());
    expect(log).toContain(`Criou o usuário ${NAME}`);
    expect(log).toContain(`Bloqueou o acesso de ${NAME}: Teste E2E`);
    expect(log).toMatch(/Cargos.*Vendedor.*Vendedor, Prestador/);
    await userCtx.close();
    await adminCtx.close();
  });
});

test.describe("auditoria", () => {
  test.use({ storageState: storage("admin") });
  test("edição de produto mostra antes e depois", async ({ page }) => {
    await page.goto("/produtos");
    await page.fill('input[aria-label="Buscar produtos"]', "BEB-005");
    await page.locator("tbody tr", { hasText: "BEB-005" }).getByRole("button", { name: /Ações de/ }).click();
    await page.getByRole("menuitem", { name: "Editar" }).click();
    await page.fill("#salePrice", "8,90");
    await page.getByRole("button", { name: "Salvar alterações" }).click();
    await toast(page, /atualizado/);
    await page.goto("/config/auditoria?area=Product");
    const first = page.locator("tbody tr").first();
    await expect(first).toContainText("Editou \"Chá mate 1,5 L\": Preço de venda");
    await expect(first).toContainText("8.50 → 8.90");
  });
});

test.describe("celular", () => {
  test.use({ storageState: storage("gerente"), viewport: { width: 390, height: 844 } });
  test("menu abre pelo botão e navega", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator("aside")).toBeHidden();
    await page.getByRole("button", { name: "Abrir menu" }).click();
    await page.getByRole("dialog").getByRole("link", { name: "Financeiro" }).click();
    await expect(page).toHaveURL(/\/financeiro$/);
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // sem rolagem horizontal da página
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
  });
});

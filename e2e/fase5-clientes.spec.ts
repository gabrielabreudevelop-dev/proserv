import { expect, test } from "@playwright/test";
import { addDays, norm, runId, skipSunday, sql, storage, toast, today } from "./helpers";

const RUN = runId();
const NAME = `Rita Clientes ${RUN}`;
const DUP = `Rita C ${RUN}`;

test.describe.serial("clientes (gerente)", () => {
  test.use({ storageState: storage("gerente") });
  let id = "";

  test("lista bate com o banco e o filtro de sumidos funciona", async ({ page }) => {
    await page.goto("/clientes");
    const total = Number(await sql(`SELECT count(*) FROM "Customer" WHERE "anonymizedAt" IS NULL`));
    const cards = page.getByRole("navigation", { name: "Filtrar clientes" });
    await expect(cards.getByRole("link").first()).toContainText(String(total));

    await cards.getByRole("link", { name: /Sumidos/ }).click();
    await expect(page).toHaveURL(/filtro=sumidos/);
    const rows = page.locator("tbody tr");
    await expect(rows.filter({ hasText: "Lúcia Ferraz" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "Marcos Teixeira" })).toHaveCount(1);
    await expect(rows.filter({ hasText: "Ana Souza" })).toHaveCount(0);

    await cards.getByRole("link", { name: /^Clientes/ }).click();
    await expect(page).toHaveURL(/\/clientes$/);
    await page.getByLabel("Buscar clientes").fill("ana souza");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/q=ana\+souza/);
    const ana = page.locator("tbody tr", { hasText: "Ana Souza" });
    await expect(ana).toHaveCount(1);
    const visits = await sql(`SELECT count(*) FROM "Appointment" a JOIN "Customer" c ON c.id = a."customerId" WHERE c.name = 'Ana Souza' AND a.status = 'CONCLUIDO'`);
    await expect(ana.locator("td").nth(1)).toHaveText(new RegExp(`^${visits}`));
    await expect(ana).toContainText("(11) 99100-0000");
  });

  test("ficha mostra histórico com os mesmos números do banco", async ({ page }) => {
    const anaId = await sql(`SELECT id FROM "Customer" WHERE name = 'Ana Souza'`);
    await page.goto(`/clientes/${anaId}`);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Ana Souza");
    await expect(page.getByText("Prefere atendimento pela manhã")).toBeVisible();
    const total = await sql(`SELECT coalesce(sum("chargedPrice"), 0)::text FROM "Appointment" WHERE "customerId" = $1 AND status = 'CONCLUIDO'`, [anaId]);
    const card = page.locator("div.rounded-xl.border.p-5", { hasText: "Gasto em serviços" });
    expect(norm(await card.textContent())).toContain(`R$ ${Number(total).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`);
    await expect(page.getByRole("link", { name: "WhatsApp" })).toHaveAttribute("href", "https://wa.me/5511991000000");
  });

  test("cadastra cliente, bloqueia duplicado e agenda pela ficha", async ({ page }) => {
    await page.goto("/clientes");
    await page.getByRole("button", { name: "Novo cliente" }).click();
    await page.fill("#cus-name", NAME);
    await page.fill("#cus-phone", "(11) 97777-6655");
    await page.fill("#cus-notes", "Gosta de horário no fim da tarde");
    await page.getByRole("button", { name: "Cadastrar cliente" }).click();
    await toast(page, /Cliente cadastrado/);
    await expect(page).toHaveURL(/\/clientes\/[a-z0-9]+$/);
    id = page.url().split("/").pop()!;
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(NAME);
    await expect(page.getByText("(11) 97777-6655")).toBeVisible();

    // Mesmo nome e telefone: recusado.
    await page.goto("/clientes");
    await page.getByRole("button", { name: "Novo cliente" }).click();
    await page.fill("#cus-name", NAME.toLowerCase());
    await page.fill("#cus-phone", "11977776655");
    await page.getByRole("button", { name: "Cadastrar cliente" }).click();
    await toast(page, /Já existe/);
    await page.keyboard.press("Escape");

    // Agendar a partir da ficha: o cliente já vem preenchido.
    const day = skipSunday(addDays(today(), 3), 1);
    await page.goto(`/clientes/${id}`);
    await page.getByRole("button", { name: "Agendar" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("#sch-customer")).toHaveValue(`${NAME} · (11) 97777-6655`);
    await expect(dialog.locator("#sch-customer-hint")).toHaveText("Cliente já cadastrado");
    await dialog.locator("#sch-date").fill(day);
    await dialog.locator("#sch-time").selectOption("18:00");
    await dialog.getByRole("button", { name: "Agendar" }).click();
    await toast(page, /Agendado/);
    const upcoming = page.locator("section[aria-labelledby='proximos']");
    await expect(upcoming).toContainText(`${day.split("-").reverse().join("/")} às 18:00`);
    expect(await sql(`SELECT count(*) FROM "Appointment" WHERE "customerId" = $1`, [id])).toBe("1");
  });

  test("edita telefone e a auditoria registra antes e depois", async ({ page }) => {
    await page.goto(`/clientes/${id}`);
    await page.getByRole("button", { name: "Editar" }).click();
    await page.fill("#cus-phone", "(21) 96666-5544");
    await page.getByRole("button", { name: "Salvar" }).click();
    await toast(page, /Cliente atualizado/);
    await expect(page.getByText("(21) 96666-5544")).toBeVisible();
    expect(await sql(`SELECT phone FROM "Customer" WHERE id = $1`, [id])).toBe("21966665544");
    expect(await sql(`SELECT summary FROM "AuditLog" WHERE "entityId" = $1 AND action = 'cliente.editar'`, [id])).toBe(`Editou o cliente ${NAME}: Telefone`);
  });

  test("venda no caixa com cliente aparece na ficha e na lista de vendas", async ({ page }) => {
    const sku = await sql(`SELECT sku FROM "Product" WHERE active AND "stockQty" >= 5 ORDER BY sku LIMIT 1`);
    await page.goto("/vendas/nova");
    await page.fill('input[aria-label="Buscar produto"]', sku);
    await page.keyboard.press("Enter");
    await page.fill("#pdv-customer", `${NAME} · (21) 96666-5544`);
    await expect(page.locator("#pdv-customer-hint")).toContainText("Cliente cadastrado");
    await page.getByRole("button", { name: "Pix", exact: true }).click();
    await page.getByRole("button", { name: "Finalizar venda" }).click();
    expect(await toast(page, /Venda nº/)).toContain(NAME);

    await page.goto(`/clientes/${id}`);
    await expect(page.locator("#compras")).toContainText("(1)");
    await page.goto("/vendas");
    await expect(page.locator("tbody tr", { hasText: NAME }).getByRole("link", { name: NAME })).toHaveAttribute("href", `/clientes/${id}`);

    // Venda de balcão continua sem cliente.
    await page.goto("/vendas/nova");
    await page.fill('input[aria-label="Buscar produto"]', sku);
    await page.keyboard.press("Enter");
    await expect(page.locator("#pdv-customer-hint")).toContainText("sem identificação");
  });

  test("junta cadastro repetido no principal", async ({ page }) => {
    await page.goto("/clientes");
    await page.getByRole("button", { name: "Novo cliente" }).click();
    await page.fill("#cus-name", DUP);
    await page.fill("#cus-notes", "Cadastro feito no balcão");
    await page.getByRole("button", { name: "Cadastrar cliente" }).click();
    await toast(page, /Cliente cadastrado/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(DUP);
    const dupId = page.url().split("/").pop()!;

    await page.getByRole("button", { name: "Mais ações do cliente" }).click();
    await page.getByRole("menuitem", { name: "Juntar com outro cadastro" }).click();
    await page.fill("#merge-target", `${NAME} · (21) 96666-5544`);
    await page.getByRole("button", { name: "Juntar cadastros" }).click();
    await toast(page, /juntados/);
    await expect(page).toHaveURL(new RegExp(`/clientes/${id}$`));
    await expect(page.getByText("Cadastro feito no balcão")).toBeVisible();
    expect(await sql(`SELECT count(*) FROM "Customer" WHERE id = $1`, [dupId])).toBe("0");
  });

  test("exclui dados pessoais a pedido (LGPD) e mantém o histórico", async ({ page }) => {
    await page.goto(`/clientes/${id}`);
    await page.getByRole("button", { name: "Mais ações do cliente" }).click();
    await page.getByRole("menuitem", { name: "Excluir dados pessoais" }).click();
    const confirm = page.getByRole("button", { name: "Excluir dados" });
    await expect(confirm).toBeDisabled();
    await page.fill("#erase-confirm", NAME);
    await confirm.click();
    await toast(page, /Dados pessoais apagados/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Cliente removido");
    await expect(page.getByText("foram apagados a pedido dele")).toBeVisible();
    await expect(page.getByRole("button", { name: "Editar" })).toHaveCount(0);
    expect(await sql(`SELECT count(*) FROM "AuditLog" WHERE summary LIKE $1`, [`%${NAME}%`])).toBe("0");
    expect(await sql(`SELECT count(*) FROM "Sale" WHERE "customerId" = $1`, [id])).toBe("1");
    await page.goto(`/clientes?q=${encodeURIComponent(NAME)}`);
    await expect(page.locator("tbody")).toContainText("Nenhum cliente encontrado");
  });
});

test.describe("vendedor", () => {
  test.use({ storageState: storage("vendedor") });
  test("escolhe cliente no caixa, mas não vê a tela de clientes", async ({ page }) => {
    await page.goto("/vendas/nova");
    await page.fill("#pdv-customer", "Ana Souza");
    await expect(page.locator("#pdv-customer-hint")).toContainText("Cliente cadastrado");
    await page.fill("#pdv-customer", `Novo Balcão ${RUN}`);
    await expect(page.getByLabel("Telefone do novo cliente")).toBeVisible();
    await expect(page.locator("aside nav")).not.toContainText("Clientes");
  });
});

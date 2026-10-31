import { expect, test } from "@playwright/test";
import { addDays, brl, dre, kpi, norm, runId, skipSunday, sql, storage, toast, today } from "./helpers";

const RUN = runId();
const SVC = `Higienização E2E ${RUN}`;
const CLIENT = `Cliente E2E ${RUN}`;
const HOUR = 56; // px por hora na grade; começa às 07:00

test.describe.serial("serviços e agenda (admin)", () => {
  test.use({ storageState: storage("admin") });
  let svcId: string, paulo: string, marina: string;
  const future = skipSunday(addDays(today(), 10), 1);
  const past = skipSunday(addDays(today(), -1), -1);

  test.beforeAll(async () => {
    paulo = await sql(`SELECT id FROM "user" WHERE email = 'prestador@proserv.local'`);
    marina = await sql(`SELECT id FROM "user" WHERE email = 'prestador2@proserv.local'`);
  });

  test("cadastra serviço com duração, valor e margem", async ({ page }) => {
    await page.goto("/servicos");
    await page.getByRole("button", { name: "Novo serviço" }).click();
    await page.fill("#svc-name", SVC);
    await page.selectOption("#svc-duration", "45");
    await page.fill("#svc-price", "120,00");
    await page.fill("#svc-cost", "20,00");
    await page.getByRole("button", { name: "Cadastrar serviço" }).click();
    await toast(page, /cadastrado/);
    const row = norm(await page.locator("tbody tr", { hasText: SVC }).textContent());
    expect(row).toContain("45 min");
    expect(row).toContain("R$ 120,00");
    expect(row).toContain("83,3%");
    svcId = await sql(`SELECT id FROM "Service" WHERE name = $1`, [SVC]);
  });

  test("agenda clicando no horário vago, avisa choque e remarca", async ({ page }) => {
    await page.goto(`/agenda?dia=${future}&visao=dia&prestador=${paulo}`);
    await page.locator(`div.relative.border-l[aria-label="Paulo Prestador"]`).click({ position: { x: 40, y: 3 * HOUR + 5 } });
    await expect(page.locator("#sch-time")).toHaveValue("10:00");
    await page.selectOption("#sch-service", svcId);
    await page.fill("#sch-customer", CLIENT);
    await page.fill("#sch-phone", "(11) 98888-7777");
    await page.getByRole("dialog").getByRole("button", { name: "Agendar" }).click();
    expect(await toast(page, /Agendado/)).toContain("10:00");
    await expect(page.locator(`button[aria-label^="10:00 ${CLIENT}"]`)).toHaveCount(1);
    expect(await sql(`SELECT phone FROM "Customer" WHERE name = $1`, [CLIENT])).toBe("11988887777");

    // Choque: 10:30 no mesmo prestador
    await page.getByRole("button", { name: "Agendar" }).click();
    await page.fill("#sch-date", future);
    await page.selectOption("#sch-time", "10:30");
    await page.selectOption("#sch-provider", paulo);
    await page.selectOption("#sch-service", svcId);
    await page.fill("#sch-customer", `Outro ${RUN}`);
    await expect(page.getByRole("dialog").locator("[role=alert]")).toContainText(`Choque com ${SVC} (${CLIENT})`);
    await expect(page.getByRole("dialog").getByRole("button", { name: "Agendar" })).toBeDisabled();
    await page.keyboard.press("Escape");

    // Futuro: concluir bloqueado; remarcar para 14:00
    await page.locator(`button[aria-label^="10:00 ${CLIENT}"]`).click();
    await expect(page.getByRole("button", { name: "Concluir" })).toBeDisabled();
    await page.getByRole("button", { name: "Remarcar" }).click();
    await page.selectOption("#rs-time", "14:00");
    await page.getByRole("button", { name: "Salvar novo horário" }).click();
    await toast(page, /remarcado/);
    await expect(page.locator(`button[aria-label^="14:00 ${CLIENT}"]`)).toHaveCount(1);
  });

  test("concluir com valor diferente da tabela entra na DRE e no dashboard; cancelar estorna", async ({ page }) => {
    const month = past.slice(0, 7);
    const recBefore = await dre(page, month, "Receita de serviços");
    const despBefore = await dre(page, month, "(−) Despesas");
    await page.goto("/dashboard?foco=servicos");
    const weekBefore = brl(await kpi(page, "Faturamento · 7 dias"));

    await page.goto(`/agenda?dia=${past}&visao=dia&prestador=${marina}`);
    await page.locator(`div.relative.border-l[aria-label="Marina Técnica"]`).click({ position: { x: 40, y: 11.5 * HOUR + 5 } }); // 18:30
    await page.selectOption("#sch-service", svcId);
    await page.fill("#sch-customer", CLIENT);
    await expect(page.locator("#sch-customer-hint")).toHaveText("Cliente já cadastrado");
    await expect(page.getByText("esse horário já passou")).toBeVisible();
    await page.getByRole("dialog").getByRole("button", { name: "Agendar" }).click();
    await toast(page, /Agendado/);

    const block = page.locator(`button[aria-label^="18:30 ${CLIENT}"]`);
    await expect(block).toHaveAttribute("aria-label", /atrasado/);
    await block.click();
    await page.getByRole("button", { name: "Concluir" }).click();
    await page.fill("#cp-price", "130,00");
    await page.getByRole("button", { name: "Pix", exact: true }).click();
    await page.getByRole("button", { name: "Confirmar conclusão" }).click();
    expect(await toast(page, /concluído/)).toContain("R$ 130,00");

    expect(await dre(page, month, "Receita de serviços")).toBeCloseTo(recBefore + 130, 2);
    expect(await dre(page, month, "(−) Despesas")).toBeCloseTo(despBefore - 20, 2);
    await page.goto("/dashboard?foco=servicos");
    expect(brl(await kpi(page, "Faturamento · 7 dias"))).toBeCloseTo(weekBefore + 130, 2);

    await page.goto(`/agenda?dia=${past}&visao=dia&prestador=${marina}`);
    await page.locator(`button[aria-label^="18:30 ${CLIENT}"]`).click();
    await page.getByRole("button", { name: "Cancelar e estornar" }).click();
    await page.fill("#cx-reason", "Teste de estorno");
    await page.getByRole("button", { name: "Confirmar cancelamento" }).click();
    await toast(page, /estornados/);
    const reversed = await sql(
      `SELECT SUM(e.amount)::text FROM "LedgerEntry" e JOIN "Appointment" a ON a.id = e."appointmentId" WHERE e.kind = 'ESTORNO' AND a."serviceId" = $1`,
      [svcId],
    );
    expect(reversed).toBe("-110.00");
  });

  test("dashboard confere com o banco", async ({ page }) => {
    const d = today();
    await page.goto("/dashboard?foco=produtos");
    const rev7 = Number(
      await sql(
        `SELECT COALESCE(SUM(total),0)::text FROM "Sale" WHERE status = 'CONCLUIDA' AND "createdAt" >= ($1::timestamp + interval '3 hours') AND "createdAt" < ($2::timestamp + interval '3 hours')`,
        [addDays(d, -6), addDays(d, 1)],
      ),
    );
    expect(brl(await kpi(page, "Faturamento · 7 dias"))).toBeCloseTo(rev7, 2);
    const low = await sql(`SELECT COUNT(*) FROM "Product" WHERE active AND ("stockQty" <= 0 OR ("minStock" IS NOT NULL AND "stockQty" <= "minStock"))`);
    expect(await kpi(page, "Estoque baixo")).toBe(String(low));

    await page.goto("/dashboard?foco=servicos");
    const todayCount = await sql(
      `SELECT COUNT(*) FROM "Appointment" WHERE status <> 'CANCELADO' AND "startsAt" >= ($1::timestamp + interval '3 hours') AND "startsAt" < ($2::timestamp + interval '3 hours')`,
      [d, addDays(d, 1)],
    );
    expect(await kpi(page, "Atendimentos hoje")).toBe(String(todayCount));
  });

  test("visão padrão do dashboard fica salva", async ({ page }) => {
    await page.goto("/dashboard?foco=servicos");
    await page.getByRole("button", { name: "Definir como padrão" }).click();
    await toast(page, /abre por padrão/);
    await page.goto("/dashboard");
    await expect(page.getByText("serviços e agenda da equipe")).toBeVisible();
    await page.goto("/dashboard?foco=produtos");
    await page.getByRole("button", { name: "Definir como padrão" }).click();
    await toast(page, /abre por padrão/);
  });
});

test.describe("agenda (prestador)", () => {
  test.use({ storageState: storage("prestador") });

  test("vê e age só na própria agenda, mesmo forçando a URL", async ({ page }) => {
    const marina = await sql(`SELECT id FROM "user" WHERE email = 'prestador2@proserv.local'`);
    await page.goto(`/agenda?visao=semana&prestador=${marina}`);
    await expect(page.locator("h1")).toHaveText("Minha agenda");
    const labels = await page.locator("button[aria-label]").evaluateAll((els) => els.map((e) => e.getAttribute("aria-label") ?? "").filter((l) => /^\d\d:\d\d /.test(l)));
    expect(labels.length).toBeGreaterThan(0);
    expect(labels.every((l) => l.includes("Paulo Prestador"))).toBe(true);
    await expect(page.getByRole("button", { name: "Agendar" })).toHaveCount(0);
    await expect(page.getByLabel("Filtrar por prestador")).toHaveCount(0);

    await page.goto(`/agenda?visao=semana&dia=${addDays(today(), 7)}`);
    await page.locator("button[aria-label*='Paulo Prestador, Agendado']").first().click();
    await expect(page.getByRole("button", { name: "Concluir" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Remarcar" })).toHaveCount(0);
  });

  test("clicar em horário vago não abre agendamento", async ({ page }) => {
    await page.goto("/agenda");
    await page.locator("div.relative.border-l").first().click({ position: { x: 30, y: 12 * HOUR + 5 } });
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });

  test("dashboard sem valores em reais; serviços sem custo; produtos bloqueado", async ({ page }) => {
    await page.goto("/dashboard");
    await expect(page.locator("main")).not.toContainText("R$");
    await page.goto("/servicos");
    const h = (await page.locator("thead th").allTextContents()).map(norm);
    expect(h).not.toContain("Custo estimado");
    await expect(page.getByRole("button", { name: "Novo serviço" })).toHaveCount(0);
    await page.goto("/produtos");
    await expect(page).toHaveURL(/\/sem-acesso$/);
  });
});

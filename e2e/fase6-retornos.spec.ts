import { expect, test } from "@playwright/test";
import { addDays, sql, storage, toast, today } from "./helpers";

const br = (iso: string) => iso.split("-").reverse().join("/");
const TODAY_SQL = `(now() AT TIME ZONE 'America/Sao_Paulo')::date`;
const pendingOf = (name: string, service: string) =>
  sql(
    `SELECT f."dueOn"::text FROM "FollowUp" f JOIN "Customer" c ON c.id = f."customerId" JOIN "Service" s ON s.id = f."serviceId"
     WHERE c.name = $1 AND s.name = $2 AND f.status = 'PENDENTE'`,
    [name, service],
  );

test.describe.serial("retornos (gerente)", () => {
  test.use({ storageState: storage("gerente") });

  test("abre nos atrasados e os números batem com o banco", async ({ page }) => {
    await page.goto("/retornos");
    const tabs = page.getByRole("navigation", { name: "Situação dos retornos" });
    await expect(tabs.getByRole("link", { name: /Atrasados/ })).toHaveAttribute("aria-current", "page");
    const late = await sql(`SELECT count(*) FROM "FollowUp" WHERE status = 'PENDENTE' AND "dueOn" < ${TODAY_SQL}`);
    await expect(tabs.getByRole("link", { name: /Atrasados/ })).toContainText(late);
    await expect(page.locator("tbody tr", { hasText: "Carla Mendes" })).toContainText("Visita técnica");
    await expect(page.locator("tbody tr", { hasText: "Marcos Teixeira" })).toContainText("Após Limpeza de ar-condicionado");
    const week = await sql(`SELECT count(*) FROM "FollowUp" WHERE status = 'PENDENTE' AND "dueOn" BETWEEN ${TODAY_SQL} AND ${TODAY_SQL} + 6`);
    await expect(tabs.getByRole("link", { name: /Esta semana/ })).toContainText(week);
  });

  test("contatar: mensagem pronta para o WhatsApp e 'falar depois' muda a data", async ({ page }) => {
    await page.goto("/retornos?aba=atrasados");
    const row = page.locator("tbody tr", { hasText: "Carla Mendes" });
    await row.getByRole("button", { name: "Contatar" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("#fu-message")).toHaveValue(/^Olá, Carla! .*Visita técnica/);
    await expect(dialog.getByRole("link", { name: "Abrir no WhatsApp" })).toHaveAttribute("href", /^https:\/\/wa\.me\/5511\d{9}\?text=Ol%C3%A1%2C%20Carla/);

    const later = addDays(today(), 10);
    await dialog.getByRole("button", { name: "Pediu para falar depois" }).click();
    await dialog.locator("#fu-snooze").fill(later);
    await dialog.locator("#fu-note").fill("Pediu para ligar depois do dia 15");
    await dialog.getByRole("button", { name: "Registrar contato" }).click();
    await toast(page, new RegExp(`Retorno para ${br(later)}`));
    expect(await pendingOf("Carla Mendes", "Visita técnica")).toBe(later);
    await expect(page.locator("tbody tr", { hasText: "Carla Mendes" })).toHaveCount(0);

    await page.goto("/retornos?aba=proximos");
    await expect(page.locator("tbody tr", { hasText: "Carla Mendes" })).toContainText("Pediu para ligar depois do dia 15");
  });

  test("agendar pelo retorno liga o atendimento e o retorno vai para Agendados", async ({ page }) => {
    await page.goto("/retornos?aba=semana");
    await page.locator("tbody tr", { hasText: "Isabela Reis" }).filter({ hasText: "Manutenção preventiva" }).getByRole("button", { name: "Agendar" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("#sch-customer")).toHaveValue(/^Isabela Reis · /);
    await expect(dialog.locator("#sch-service option:checked")).toHaveText(/^Manutenção preventiva/);
    await dialog.locator("#sch-provider").selectOption({ label: "Paulo Prestador" });
    await dialog.locator("#sch-time").selectOption("16:30");
    await dialog.getByRole("button", { name: "Agendar" }).click();
    await toast(page, /Agendado/);

    const status = await sql(
      `SELECT f.status || ' ' || (f."appointmentId" IS NOT NULL) FROM "FollowUp" f JOIN "Customer" c ON c.id = f."customerId" JOIN "Service" s ON s.id = f."serviceId"
       WHERE c.name = 'Isabela Reis' AND s.name = 'Manutenção preventiva' AND f.status IN ('PENDENTE','AGENDADO')`,
    );
    expect(status).toBe("AGENDADO true");
    await page.goto("/retornos?aba=agendados");
    await expect(page.locator("tbody tr", { hasText: "Isabela Reis" }).filter({ hasText: "Manutenção preventiva" })).toContainText("16:30");
  });

  test("encerrar com motivo leva para o histórico", async ({ page }) => {
    await page.goto("/retornos?aba=semana");
    await page.getByRole("button", { name: "Mais ações do retorno de João Pedro Martins" }).click();
    await page.getByRole("menuitem", { name: "Encerrar retorno" }).click();
    await page.fill("#fu-reason", "Mudou de cidade");
    await page.getByRole("dialog").getByRole("button", { name: "Encerrar retorno" }).click();
    await toast(page, /Retorno encerrado/);
    await page.goto("/retornos?aba=historico");
    await expect(page.locator("tbody tr", { hasText: "João Pedro Martins" }).filter({ hasText: "Mudou de cidade" })).toHaveCount(1);
  });

  test("concluir um atendimento com retorno cumpre o anterior e programa o próximo na data escolhida", async ({ page }) => {
    const yesterday = addDays(today(), -1);
    const lucia = await sql(`SELECT id FROM "Customer" WHERE name = 'Lúcia Ferraz'`);
    const paulo = await sql(`SELECT id FROM "user" WHERE email = 'prestador@proserv.local'`);
    const before = await pendingOf("Lúcia Ferraz", "Limpeza de ar-condicionado");
    expect(before).not.toBe("");

    // Agenda pela ficha (serviço preferido já vem escolhido), ontem às 18:00.
    await page.goto(`/clientes/${lucia}`);
    await expect(page.locator("section[aria-labelledby='retornos']")).toContainText("Limpeza de ar-condicionado");
    await page.getByRole("button", { name: "Agendar" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.locator("#sch-service option:checked")).toHaveText(/^Limpeza de ar-condicionado/);
    await dialog.locator("#sch-provider").selectOption({ label: "Paulo Prestador" });
    await dialog.locator("#sch-date").fill(yesterday);
    await dialog.locator("#sch-time").selectOption("18:00");
    await dialog.getByRole("button", { name: "Agendar" }).click();
    await toast(page, /Agendado/);

    await page.goto(`/agenda?dia=${yesterday}&visao=dia&prestador=${paulo}`);
    await page.locator(`button[aria-label^="18:00 Lúcia Ferraz"]`).click();
    await page.getByRole("button", { name: "Concluir" }).click();
    await expect(page.getByLabel("Programar retorno")).toBeChecked();
    const custom = addDays(yesterday, 45);
    await page.fill("#cp-return", custom);
    await page.getByRole("button", { name: "Pix", exact: true }).click();
    await page.getByRole("button", { name: "Confirmar conclusão" }).click();
    await toast(page, /concluído/);

    expect(await pendingOf("Lúcia Ferraz", "Limpeza de ar-condicionado")).toBe(custom);
    expect(
      await sql(
        `SELECT count(*) FROM "FollowUp" f JOIN "Customer" c ON c.id = f."customerId" WHERE c.name = 'Lúcia Ferraz' AND f.status = 'REALIZADO' AND f."dueOn"::text = $1`,
        [before],
      ),
    ).toBe("1");
  });

  test("serviço guarda a regra de retorno", async ({ page }) => {
    await page.goto("/servicos");
    const row = page.locator("tbody tr", { hasText: "Instalação de ar-condicionado" });
    await expect(row).toContainText("Em 6 meses");
    await expect(row).toContainText("Manutenção preventiva");
    await page.getByRole("button", { name: "Editar Visita técnica" }).click();
    await page.selectOption("#svc-return", "12");
    await page.selectOption("#svc-return-service", { label: "Manutenção preventiva" });
    await page.getByRole("button", { name: "Salvar" }).click();
    await toast(page, /Serviço atualizado/);
    await expect(page.locator("tbody tr", { hasText: "Visita técnica" })).toContainText("Em 12 meses");
    expect(await sql(`SELECT summary FROM "AuditLog" WHERE action = 'servico.editar' ORDER BY "createdAt" DESC LIMIT 1`)).toBe('Editou o serviço "Visita técnica": Retorno');
  });
});

test.describe("dashboard e acesso", () => {
  test("gerente vê os retornos no dashboard de serviços", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storage("gerente") });
    const page = await ctx.newPage();
    await page.goto("/dashboard?foco=servicos");
    const card = page.locator("section[aria-labelledby='returns-s']");
    await expect(card).toContainText("Retornos para contatar");
    await expect(card.getByRole("link", { name: "Abrir retornos" })).toHaveAttribute("href", "/retornos");
    await ctx.close();
  });

  test("prestador conclui com retorno, mas não vê a tela nem o cartão", async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storage("prestador") });
    const page = await ctx.newPage();
    await page.goto("/dashboard?foco=servicos");
    await expect(page.locator("section[aria-labelledby='returns-s']")).toHaveCount(0);
    await expect(page.locator("aside nav")).not.toContainText("Retornos");
    await ctx.close();
  });
});

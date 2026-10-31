/** Faz login uma vez por cargo e guarda a sessão para os demais testes. */
import { expect, test as setup } from "@playwright/test";
import { login, loginPause, ROLES, storage } from "./helpers";

for (const [i, role] of ROLES.entries()) {
  setup(`login como ${role}`, async ({ page }) => {
    setup.setTimeout(60_000);
    if (i > 0 && i % 2 === 0) await loginPause(); // respeita o limite de 3 logins / 10 s
    await login(page, `${role}@proserv.local`);
    await expect(page).toHaveURL(/\/dashboard$/);
    await page.context().storageState({ path: storage(role) });
  });
}

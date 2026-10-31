import { expect, type Page } from "@playwright/test";
import { Client } from "pg";
import { E2E_DATABASE_URL } from "../playwright.config";

export const PASSWORD = "proserv123";
export const ROLES = ["admin", "gerente", "vendedor", "prestador"] as const;
export type Role = (typeof ROLES)[number];
export const storage = (role: Role) => `e2e/.auth/${role}.json`;

/** Consulta o banco de E2E e devolve a primeira coluna da primeira linha. */
export async function sql<T = string>(query: string, params: unknown[] = []): Promise<T> {
  const c = new Client({ connectionString: E2E_DATABASE_URL });
  await c.connect();
  try {
    const r = await c.query(query, params);
    const row = r.rows[0];
    return (row ? Object.values(row)[0] : null) as T;
  } finally {
    await c.end();
  }
}

/** Texto normalizado: espaço não separável vira espaço comum. */
export const norm = (t: string | null | undefined) => (t ?? "").replace(/ /g, " ").replace(/\s+/g, " ").trim();

/** "R$ 1.234,56" / "-R$ 5,00" → número. */
export function brl(t: string | null | undefined) {
  const s = norm(t);
  const n = Number(s.replace(/[^\d,]/g, "").replace(",", "."));
  return s.startsWith("-") ? -n : n;
}

export const runId = () => Date.now().toString(36).slice(-4).toUpperCase();

/** Espera um aviso (toast) com o texto e devolve o conteúdo. */
export async function toast(page: Page, re: RegExp) {
  const t = page.locator("[data-sonner-toast]", { hasText: re }).first();
  await expect(t).toBeVisible();
  return norm(await t.textContent());
}

/** Login pela tela. O Better Auth limita a 3 tentativas a cada 10 s por IP. */
export async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/login");
  await page.fill("#email", email);
  await page.fill("#password", password);
  await page.click("button[type=submit]");
}

/** Pausa para respeitar o limite de login entre logins seguidos. */
export const loginPause = () => new Promise((r) => setTimeout(r, 11_000));

/** Datas locais (Brasília). */
export const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
export const addDays = (iso: string, n: number) => new Date(Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8) + n)).toISOString().slice(0, 10);
export const skipSunday = (iso: string, dir: 1 | -1) => (new Date(`${iso}T12:00:00Z`).getUTCDay() === 0 ? addDays(iso, dir) : iso);

/** Valor de um KPI pelo rótulo. */
export async function kpi(page: Page, label: string) {
  const card = page.locator("div.rounded-xl.border.p-5", { has: page.getByText(label, { exact: true }) });
  return norm(await card.locator("p").nth(1).textContent());
}

/** Valor de uma linha da DRE na tela do Financeiro. */
export async function dre(page: Page, month: string, label: string) {
  await page.goto(`/financeiro?mes=${month}`);
  const row = page.locator("section[aria-labelledby='dre-title'] tr", { hasText: label }).first();
  return brl(await row.locator("td").nth(1).textContent());
}

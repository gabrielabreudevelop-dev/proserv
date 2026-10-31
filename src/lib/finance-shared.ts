/** Constantes e utilidades de vendas/finanças seguras para o cliente. */

export const PAYMENT_METHODS = {
  PIX: "Pix",
  DINHEIRO: "Dinheiro",
  DEBITO: "Cartão de débito",
  CREDITO: "Cartão de crédito",
  OUTRO: "Outro",
} as const;
export type PaymentMethod = keyof typeof PAYMENT_METHODS;

export const EXPENSE_CATEGORIES = [
  "Aluguel",
  "Energia",
  "Água",
  "Internet e telefone",
  "Salários e encargos",
  "Impostos e taxas",
  "Fornecedores",
  "Marketing",
  "Manutenção",
  "Outros",
] as const;

export const LEDGER_KIND_LABELS = {
  RECEITA_PRODUTO: "Receita de produtos",
  RECEITA_SERVICO: "Receita de serviços",
  CMV: "Custo das mercadorias vendidas",
  DESPESA: "Despesa",
  ESTORNO: "Estorno",
} as const;
export type LedgerKindName = keyof typeof LEDGER_KIND_LABELS;

/** Categoria gravada nos estornos — diz em qual linha da DRE o estorno entra. */
export const REVERSAL_CATEGORY = {
  receita: "Estorno de receita",
  cmv: "Estorno de CMV",
  despesa: "Estorno de despesa",
} as const;

export const BUSINESS_TZ_OFFSET = "-03:00"; // America/Sao_Paulo (sem horário de verão desde 2019)

/** "2026-10" → intervalo [início, fim) em UTC correspondente ao mês em São Paulo. */
export function monthRange(month: string): { from: Date; to: Date } {
  const m = /^(\d{4})-(\d{2})$/.exec(month);
  if (!m) throw new Error(`Mês inválido: ${month}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const next = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
  return {
    from: new Date(`${month}-01T00:00:00${BUSINESS_TZ_OFFSET}`),
    to: new Date(`${next}-01T00:00:00${BUSINESS_TZ_OFFSET}`),
  };
}

/** Mês atual em São Paulo no formato "2026-10". */
export function currentMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit" }).formatToParts(now);
  return `${parts.find((p) => p.type === "year")!.value}-${parts.find((p) => p.type === "month")!.value}`;
}

export function shiftMonth(month: string, delta: number) {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string) {
  const [y, m] = month.split("-").map(Number);
  const label = new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 15)));
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/** Data de hoje em São Paulo, "2026-10-30". */
export function todayISO(now = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(now);
}

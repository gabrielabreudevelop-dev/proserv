/** Formatação e leitura de números no padrão brasileiro. Seguro para servidor e cliente. */

const brl = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const qty = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 3 });
const pct = new Intl.NumberFormat("pt-BR", { style: "percent", maximumFractionDigits: 1 });

export const formatBRL = (value: number | string) => brl.format(Number(value));
export const formatQty = (value: number | string) => qty.format(Number(value));
export const formatPct = (ratio: number) => pct.format(ratio);

/** "2027-06-30" → "30/06/2027" sem passar por Date (evita erro de fuso). */
export function formatDateISO(iso: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

/**
 * Converte o que a pessoa digitou em um número decimal canônico ("1234.5").
 * Aceita "1.234,50", "1234,5", "1234.50", "R$ 12,00". Retorna null se inválido.
 */
export function parseDecimalInput(raw: unknown): string | null {
  if (typeof raw === "number") return Number.isFinite(raw) ? String(raw) : null;
  if (typeof raw !== "string") return null;
  let s = raw.replace(/R\$|\s/g, "").trim();
  if (!s) return null;
  const negative = s.startsWith("-");
  if (negative) s = s.slice(1);
  const hasComma = s.includes(",");
  // Com vírgula, pontos são milhar ("1.234,56"); sem vírgula, ponto é decimal ("1234.56").
  if (hasComma) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const normalized = s.replace(/^0+(?=\d)/, "");
  return negative ? `-${normalized}` : normalized;
}

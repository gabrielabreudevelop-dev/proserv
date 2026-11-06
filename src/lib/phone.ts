/** Telefones brasileiros: guardados só com dígitos (DDD + número), exibidos formatados. */

/** "(11) 99100-7919" / "+55 11 99100 7919" → "11991007919". Vazio → null. */
export function normalizePhone(raw: string | null | undefined): string | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if (!d) return null;
  // Tira o código do país quando veio junto (55 + DDD + número).
  if (d.length >= 12 && d.startsWith("55")) d = d.slice(2);
  return d;
}

/** Aceita número com DDD (10 ou 11 dígitos) ou sem DDD (8 ou 9). */
export function isValidPhone(digits: string | null) {
  return digits === null || (digits.length >= 8 && digits.length <= 11);
}

export function formatPhone(digits: string | null | undefined): string {
  if (!digits) return "";
  const d = digits.replace(/\D/g, "");
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 9) return `${d.slice(0, 5)}-${d.slice(5)}`;
  if (d.length === 8) return `${d.slice(0, 4)}-${d.slice(4)}`;
  return d;
}

/** Link do WhatsApp — só para celular com DDD (11 dígitos, começa com 9). */
export function whatsappUrl(digits: string | null | undefined): string | null {
  if (!digits || digits.length !== 11 || digits[2] !== "9") return null;
  return `https://wa.me/55${digits}`;
}

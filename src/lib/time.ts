/** Datas e horários no fuso do negócio (America/Sao_Paulo, UTC−3 fixo). Seguro para cliente e servidor. */
import { BUSINESS_TZ_OFFSET } from "./finance-shared";

export const AGENDA_START_HOUR = 7;
export const AGENDA_END_HOUR = 20;
export const SLOT_MINUTES = 30;

const partsFmt = new Intl.DateTimeFormat("en-CA", {
  timeZone: "America/Sao_Paulo",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** Data e hora locais de um instante: { date: "2026-10-30", time: "14:30", minutes: 870 }. */
export function localParts(d: Date) {
  const p = Object.fromEntries(partsFmt.formatToParts(d).map((x) => [x.type, x.value]));
  const time = `${p.hour}:${p.minute}`;
  return { date: `${p.year}-${p.month}-${p.day}`, time, minutes: Number(p.hour) * 60 + Number(p.minute) };
}

/** "2026-10-30" + "14:30" → instante correspondente em Brasília. */
export function atLocal(date: string, time: string) {
  return new Date(`${date}T${time}:00${BUSINESS_TZ_OFFSET}`);
}

export function addDays(date: string, n: number) {
  const [y, m, d] = date.split("-").map(Number);
  const x = new Date(Date.UTC(y, m - 1, d + n));
  return x.toISOString().slice(0, 10);
}

/** Segunda-feira da semana de `date`. */
export function weekStart(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = domingo
  return addDays(date, dow === 0 ? -6 : 1 - dow);
}

/** Intervalo [início, fim) de `days` dias a partir de `date`, em Brasília. */
export function localRange(date: string, days = 1) {
  return { from: atLocal(date, "00:00"), to: atLocal(addDays(date, days), "00:00") };
}

export function isISODate(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

const weekdayFmt = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" });
const longFmt = new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });

/** "seg", "ter"… */
export function weekdayShort(date: string) {
  return weekdayFmt.format(new Date(`${date}T12:00:00Z`)).replace(".", "");
}

/** "Sexta-feira, 30 de outubro" */
export function longDate(date: string) {
  const s = longFmt.format(new Date(`${date}T12:00:00Z`));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function minutesToTime(min: number) {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

export function formatDuration(min: number) {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h && m ? `${h} h ${m} min` : h ? `${h} h` : `${m} min`;
}

/** Instante ISO → "03/03/2025" no fuso do negócio. */
export function formatLocalDate(iso: string) {
  const { date } = localParts(new Date(iso));
  return date.split("-").reverse().join("/");
}

/** Instante ISO → "03/03/2025 às 09:00". */
export function formatLocalDateTime(iso: string) {
  const { date, time } = localParts(new Date(iso));
  return `${date.split("-").reverse().join("/")} às ${time}`;
}

/** Dias corridos (no calendário local) entre dois instantes: hoje = 0. */
export function daysBetween(fromIso: string, to: Date) {
  const a = new Date(`${localParts(new Date(fromIso)).date}T12:00:00Z`).getTime();
  const b = new Date(`${localParts(to).date}T12:00:00Z`).getTime();
  return Math.round((b - a) / 86_400_000);
}

/** "hoje", "ontem", "há 12 dias", "há 3 meses", "há 1 ano". */
export function agoLabel(fromIso: string, now: Date) {
  const d = daysBetween(fromIso, now);
  if (d <= 0) return "hoje";
  if (d === 1) return "ontem";
  if (d < 60) return `há ${d} dias`;
  if (d < 365) return `há ${Math.floor(d / 30)} meses`;
  const y = Math.floor(d / 365);
  return `há ${y} ano${y > 1 ? "s" : ""}`;
}

/** "2026-01-31" + 1 mês → "2026-02-28" (fica no último dia quando o mês é mais curto). */
export function addMonthsISO(date: string, months: number) {
  const [y, m, d] = date.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const last = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
  return `${ny}-${String(nm).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** Dias entre duas datas de calendário ("YYYY-MM-DD"): b − a. */
export function diffDaysISO(a: string, b: string) {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

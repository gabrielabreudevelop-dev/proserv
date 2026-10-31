import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { currentMonth, monthLabel, shiftMonth } from "@/lib/finance-shared";
import { Button } from "@/components/ui/button";

/** Navegação de mês por link (?mes=2026-10). Funciona sem JavaScript. */
export function MonthPicker({ month, basePath }: { month: string; basePath: string }) {
  const isCurrent = month === currentMonth();
  const href = (m: string) => `${basePath}?mes=${m}`;
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Período">
      <Button variant="outline" size="icon" className="size-9" asChild>
        <Link href={href(shiftMonth(month, -1))} aria-label="Mês anterior">
          <ChevronLeft />
        </Link>
      </Button>
      <span className="min-w-40 text-center text-sm font-medium tabular-nums" aria-live="polite">
        {monthLabel(month)}
      </span>
      <Button variant="outline" size="icon" className="size-9" asChild aria-disabled={isCurrent}>
        <Link href={href(shiftMonth(month, 1))} aria-label="Próximo mês" className={isCurrent ? "pointer-events-none opacity-40" : undefined} tabIndex={isCurrent ? -1 : undefined}>
          <ChevronRight />
        </Link>
      </Button>
      {!isCurrent && (
        <Button variant="ghost" size="sm" asChild>
          <Link href={basePath}>Mês atual</Link>
        </Button>
      )}
    </div>
  );
}

/** Lê ?mes=AAAA-MM com segurança; inválido ou futuro → mês atual. */
export function parseMonthParam(raw: string | string[] | undefined) {
  const now = currentMonth();
  const value = typeof raw === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(raw) ? raw : now;
  return value > now ? now : value;
}

export function Kpi({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: "positive" | "negative" }) {
  return (
    <div className="rounded-xl border p-5">
      <p className="text-sm text-muted-foreground">{label}</p>
      <p
        className={
          "mt-1 text-2xl font-semibold tracking-tight tabular-nums " +
          (tone === "negative" ? "text-destructive" : tone === "positive" ? "text-success" : "")
        }
      >
        {value}
      </p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

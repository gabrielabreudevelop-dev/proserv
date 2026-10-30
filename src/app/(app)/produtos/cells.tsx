import type { FieldDef } from "@/lib/custom-fields";
import { formatDateISO, formatQty } from "@/lib/format";
import { stockStatus } from "@/lib/stock-shared";
import { cn } from "@/lib/utils";

/** Valor de um campo personalizado formatado conforme o tipo. */
export function CustomValue({ def, value }: { def: FieldDef; value: unknown }) {
  if (value === undefined || value === null || value === "") return <span className="text-muted-foreground/60">—</span>;
  switch (def.type) {
    case "DATE":
      return <span className="tabular-nums">{formatDateISO(String(value))}</span>;
    case "NUMBER":
      return <span className="tabular-nums">{formatQty(Number(value))}</span>;
    case "BOOLEAN":
      return <span>{value ? "Sim" : "Não"}</span>;
    default:
      return <span className="block max-w-56 truncate" title={String(value)}>{String(value)}</span>;
  }
}

export function StockCell({ stockQty, minStock }: { stockQty: string; minStock: string | null }) {
  const qty = Number(stockQty);
  const status = stockStatus(qty, minStock === null ? null : Number(minStock));
  return (
    <span className="inline-flex items-center justify-end gap-2">
      {status !== "ok" && (
        <span
          className={cn(
            "rounded px-1.5 py-0.5 text-[11px] font-medium",
            status === "zerado" ? "bg-destructive/10 text-destructive" : "bg-warning/20 text-warning-foreground",
          )}
          title={minStock ? `Mínimo: ${formatQty(minStock)}` : undefined}
        >
          {status === "zerado" ? "Zerado" : "Baixo"}
        </span>
      )}
      <span className={cn("tabular-nums", status === "zerado" && "text-destructive")}>{formatQty(qty)}</span>
    </span>
  );
}

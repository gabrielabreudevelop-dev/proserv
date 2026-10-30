"use client";

import { Fragment, useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { FieldDef } from "@/lib/custom-fields";
import { formatBRL, formatQty } from "@/lib/format";
import { MOVEMENT_LABELS } from "@/lib/stock-shared";
import { cn } from "@/lib/utils";
import type { ProductRow } from "@/server/services/products";
import type { MovementRow } from "@/server/services/stock";
import { getMovementsAction } from "@/server/actions/products";
import { CustomValue } from "./cells";

const dateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });

/** Linha expandida: todos os campos (inclusive colunas ocultas) e as últimas movimentações. */
export function ProductDetails({ product, fields, seeCost }: { product: ProductRow; fields: FieldDef[]; seeCost: boolean }) {
  const [movements, setMovements] = useState<MovementRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const version = `${product.stockQty}|${product.avgCost ?? ""}`;

  useEffect(() => {
    let cancelled = false;
    getMovementsAction(product.id).then((res) => {
      if (cancelled) return;
      if (res.ok) setMovements(res.data);
      else setError(res.error);
    });
    return () => {
      cancelled = true;
    };
    // Recarrega quando o estoque muda (após entrada/ajuste).
  }, [product.id, version]);

  return (
    <div className="grid gap-6 px-12 py-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)]">
      <section aria-label="Campos do produto">
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Campos</h3>
        <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-sm">
          <dt className="text-muted-foreground">Estoque mínimo</dt>
          <dd className="tabular-nums">{product.minStock ? formatQty(product.minStock) : "—"}</dd>
          {fields.map((f) => (
            <Fragment key={f.id}>
              <dt className="text-muted-foreground">{f.label}</dt>
              <dd>
                <CustomValue def={f} value={product.customFields[f.key]} />
              </dd>
            </Fragment>
          ))}
          {fields.length === 0 && (
            <dd className="col-span-2 text-muted-foreground">Nenhum campo personalizado criado.</dd>
          )}
        </dl>
      </section>

      <section aria-label="Últimas movimentações">
        <h3 className="mb-3 text-xs font-medium uppercase tracking-wider text-muted-foreground">Últimas movimentações</h3>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : movements === null ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Carregando…
          </p>
        ) : movements.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem movimentações.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr>
                <th className="pb-2 font-medium">Data</th>
                <th className="pb-2 font-medium">Tipo</th>
                <th className="pb-2 text-right font-medium">Qtd.</th>
                {seeCost && <th className="pb-2 text-right font-medium">Custo un.</th>}
                <th className="pb-2 pl-4 font-medium">Por / observação</th>
              </tr>
            </thead>
            <tbody>
              {movements.map((m) => {
                const q = Number(m.quantity);
                return (
                  <tr key={m.id} className="border-t border-border/60">
                    <td className="py-1.5 tabular-nums text-muted-foreground">{dateTime.format(new Date(m.createdAt))}</td>
                    <td className="py-1.5">{MOVEMENT_LABELS[m.type as keyof typeof MOVEMENT_LABELS] ?? m.type}</td>
                    <td className={cn("py-1.5 text-right tabular-nums", q < 0 ? "text-destructive" : "text-success")}>
                      {q > 0 ? "+" : ""}
                      {formatQty(q)}
                    </td>
                    {seeCost && <td className="py-1.5 text-right tabular-nums text-muted-foreground">{m.unitCost !== null ? formatBRL(m.unitCost) : "—"}</td>}
                    <td className="max-w-72 truncate py-1.5 pl-4 text-muted-foreground" title={m.note ?? undefined}>
                      {m.createdBy}
                      {m.note ? ` · ${m.note}` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}


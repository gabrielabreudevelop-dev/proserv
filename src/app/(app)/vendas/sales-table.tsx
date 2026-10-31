"use client";

import { Fragment, useState, useTransition } from "react";
import { ChevronRight, Loader2, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { formatBRL, formatQty } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SaleListRow } from "@/server/services/sales";
import { cancelSaleAction } from "@/server/actions/sales";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Textarea } from "@/components/ui/form-controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const dateTime = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

export function SalesTable({ sales, showSeller, seeCost, canCancel }: { sales: SaleListRow[]; showSeller: boolean; seeCost: boolean; canCancel: boolean }) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [cancelling, setCancelling] = useState<SaleListRow | null>(null);
  const cols = 6 + (showSeller ? 1 : 0) + (canCancel ? 1 : 0);

  const toggle = (id: string) =>
    setOpen((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <>
      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-10 pr-0">
                <span className="sr-only">Detalhes</span>
              </TableHead>
              <TableHead>Nº</TableHead>
              <TableHead>Data</TableHead>
              {showSeller && <TableHead>Vendedor</TableHead>}
              <TableHead className="text-right">Itens</TableHead>
              <TableHead>Pagamento</TableHead>
              <TableHead className="text-right">Total</TableHead>
              {canCancel && (
                <TableHead className="w-28">
                  <span className="sr-only">Ações</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sales.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={cols} className="h-32 text-center text-muted-foreground">
                  Nenhuma venda neste mês.
                </TableCell>
              </TableRow>
            )}
            {sales.map((s) => {
              const isOpen = open.has(s.id);
              const cancelled = s.status === "CANCELADA";
              return (
                <Fragment key={s.id}>
                  <TableRow data-state={isOpen ? "selected" : undefined} className={cn(cancelled && "text-muted-foreground")}>
                    <TableCell className="pr-0">
                      <button
                        type="button"
                        onClick={() => toggle(s.id)}
                        aria-expanded={isOpen}
                        aria-label={isOpen ? `Recolher venda ${s.number}` : `Ver itens da venda ${s.number}`}
                        className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
                      >
                        <ChevronRight className={cn("size-4 transition-transform", isOpen && "rotate-90")} />
                      </button>
                    </TableCell>
                    <TableCell className="font-mono text-xs">#{s.number}</TableCell>
                    <TableCell className="tabular-nums">{dateTime.format(new Date(s.createdAt))}</TableCell>
                    {showSeller && <TableCell>{s.seller}</TableCell>}
                    <TableCell className="text-right tabular-nums">{formatQty(s.itemsCount)}</TableCell>
                    <TableCell>{s.paymentMethod}</TableCell>
                    <TableCell className="text-right">
                      <span className="inline-flex items-center gap-2">
                        {cancelled && <Badge variant="outline" className="text-destructive">Cancelada</Badge>}
                        <span className={cn("font-medium tabular-nums", cancelled && "line-through")}>{formatBRL(s.total)}</span>
                      </span>
                    </TableCell>
                    {canCancel && (
                      <TableCell className="py-1 text-right">
                        {!cancelled && (
                          <Button variant="ghost" size="sm" onClick={() => setCancelling(s)} aria-label={`Cancelar venda ${s.number}`}>
                            <Undo2 /> Cancelar
                          </Button>
                        )}
                      </TableCell>
                    )}
                  </TableRow>
                  {isOpen && (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={cols} className="whitespace-normal px-12 py-4">
                        <SaleDetails sale={s} seeCost={seeCost} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <CancelDialog sale={cancelling} onClose={() => setCancelling(null)} />
    </>
  );
}

function SaleDetails({ sale, seeCost }: { sale: SaleListRow; seeCost: boolean }) {
  const cost = Number(sale.cost ?? 0);
  const profit = Number(sale.total) - cost;
  return (
    <div className="space-y-3">
      <table className="w-full max-w-3xl text-sm">
        <thead className="text-left text-xs text-muted-foreground">
          <tr>
            <th className="pb-2 font-medium">Produto</th>
            <th className="pb-2 text-right font-medium">Qtd.</th>
            <th className="pb-2 text-right font-medium">Preço un.</th>
            {seeCost && <th className="pb-2 text-right font-medium">Custo un.</th>}
            <th className="pb-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody>
          {sale.items.map((i) => (
            <tr key={i.sku} className="border-t border-border/60">
              <td className="py-1.5">
                {i.name} <span className="font-mono text-xs text-muted-foreground">{i.sku}</span>
              </td>
              <td className="py-1.5 text-right tabular-nums">{formatQty(i.quantity)}</td>
              <td className="py-1.5 text-right tabular-nums">{formatBRL(i.unitPrice)}</td>
              {seeCost && <td className="py-1.5 text-right tabular-nums text-muted-foreground">{formatBRL(i.unitCost ?? 0)}</td>}
              <td className="py-1.5 text-right tabular-nums">{formatBRL(Number(i.quantity) * Number(i.unitPrice))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <dl className="flex flex-wrap gap-x-8 gap-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Subtotal</dt>
          <dd className="tabular-nums">{formatBRL(sale.subtotal)}</dd>
        </div>
        {Number(sale.discount) > 0 && (
          <div className="flex gap-2">
            <dt className="text-muted-foreground">Desconto</dt>
            <dd className="tabular-nums">− {formatBRL(sale.discount)}</dd>
          </div>
        )}
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Total</dt>
          <dd className="font-medium tabular-nums">{formatBRL(sale.total)}</dd>
        </div>
        {seeCost && (
          <>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Custo (CMV)</dt>
              <dd className="tabular-nums">{formatBRL(cost)}</dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-muted-foreground">Lucro bruto</dt>
              <dd className={cn("font-medium tabular-nums", profit < 0 && "text-destructive")}>{formatBRL(profit)}</dd>
            </div>
          </>
        )}
      </dl>
      {sale.cancelReason && <p className="text-sm text-destructive">Cancelada: {sale.cancelReason}</p>}
    </div>
  );
}

function CancelDialog({ sale, onClose }: { sale: SaleListRow | null; onClose: () => void }) {
  const [error, setError] = useState<string | undefined>();
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!sale) return;
    const reason = new FormData(e.currentTarget).get("reason");
    start(async () => {
      const res = await cancelSaleAction({ saleId: sale.id, reason });
      if (!res.ok) {
        setError(res.fieldErrors?.reason);
        return void toast.error(res.error);
      }
      toast.success(`Venda nº ${res.data.number} cancelada. Estoque devolvido e valores estornados.`);
      setError(undefined);
      onClose();
    });
  }

  return (
    <Dialog
      open={sale !== null}
      onOpenChange={(o) => {
        if (!o) {
          setError(undefined);
          onClose();
        }
      }}
    >
      <DialogContent>
        {sale && (
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>Cancelar a venda nº {sale.number}?</DialogTitle>
              <DialogDescription>
                {formatBRL(sale.total)} · os itens voltam ao estoque e a receita e o custo são estornados hoje. Não dá para desfazer.
              </DialogDescription>
            </DialogHeader>
            <Field id="cancel-reason" label="Motivo" required error={error}>
              <Textarea name="reason" rows={3} maxLength={200} placeholder="Ex.: cliente desistiu, erro de digitação" autoFocus />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onClose}>
                Voltar
              </Button>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending && <Loader2 className="animate-spin" />} Cancelar venda
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

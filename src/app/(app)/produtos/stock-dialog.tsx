"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatBRL, formatQty, parseDecimalInput } from "@/lib/format";
import { ADJUSTMENT_REASONS, type AdjustmentReason } from "@/lib/stock-shared";
import type { ProductRow } from "@/server/services/products";
import { stockAdjustmentAction, stockEntryAction } from "@/server/actions/products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/ui/form-controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

type State = { kind: "entry" | "adjust"; product: ProductRow } | null;

export function StockDialog({ state, onClose, seeCost }: { state: State; onClose: () => void; seeCost: boolean }) {
  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent>
        {state?.kind === "entry" && <EntryForm product={state.product} onDone={onClose} seeCost={seeCost} />}
        {state?.kind === "adjust" && <AdjustForm product={state.product} onDone={onClose} seeCost={seeCost} />}
      </DialogContent>
    </Dialog>
  );
}

function EntryForm({ product, onDone, seeCost }: { product: ProductRow; onDone: () => void; seeCost: boolean }) {
  const [qty, setQty] = useState("");
  const [cost, setCost] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  // Prévia do novo custo médio enquanto a pessoa digita.
  const q = Number(parseDecimalInput(qty) ?? NaN);
  const c = Number(parseDecimalInput(cost) ?? NaN);
  const current = Number(product.stockQty);
  const avg = Number(product.avgCost ?? 0);
  const preview = q > 0 && c >= 0 ? (current <= 0 ? c : (current * avg + q * c) / (current + q)) : null;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const note = new FormData(e.currentTarget).get("note");
    start(async () => {
      const res = await stockEntryAction({ productId: product.id, quantity: qty, unitCost: cost, note });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        return void toast.error(res.error);
      }
      toast.success(`Entrada registrada. Estoque: ${formatQty(res.data.stockQty)}`);
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Entrada de estoque</DialogTitle>
        <DialogDescription>
          {product.name} · estoque atual {formatQty(product.stockQty)}
          {seeCost && product.avgCost !== undefined && ` · custo médio ${formatBRL(product.avgCost)}`}
        </DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-4">
        <Field id="entry-qty" label="Quantidade" required error={errors.quantity}>
          <Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
        </Field>
        <Field id="entry-cost" label="Custo unitário (R$)" required error={errors.unitCost}>
          <Input inputMode="decimal" placeholder="0,00" value={cost} onChange={(e) => setCost(e.target.value)} />
        </Field>
      </div>
      <Field id="entry-note" label="Observação" hint="Ex.: nota fiscal 1234, fornecedor">
        <Input name="note" maxLength={200} />
      </Field>
      {seeCost && preview !== null && (
        <p className="rounded-md bg-muted px-3 py-2 text-sm">
          Novo estoque <strong className="tabular-nums">{formatQty(current + q)}</strong> · novo custo médio{" "}
          <strong className="tabular-nums">{formatBRL(preview.toFixed(4))}</strong>
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Registrar entrada
        </Button>
      </DialogFooter>
    </form>
  );
}

function AdjustForm({ product, onDone, seeCost }: { product: ProductRow; onDone: () => void; seeCost: boolean }) {
  const [reason, setReason] = useState<AdjustmentReason>("PERDA");
  const [qty, setQty] = useState("");
  const [direction, setDirection] = useState<"out" | "in">("out");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  const canAdd = reason === "CONTAGEM";
  const effectiveDirection = canAdd ? direction : "out";
  const q = Number(parseDecimalInput(qty) ?? NaN);
  const loss = effectiveDirection === "out" && q > 0 && product.avgCost !== undefined ? q * Number(product.avgCost) : null;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const note = new FormData(e.currentTarget).get("note");
    const parsed = parseDecimalInput(qty);
    if (!parsed || Number(parsed) <= 0) return setErrors({ delta: "Informe uma quantidade maior que zero" });
    const delta = effectiveDirection === "out" ? `-${parsed}` : parsed;
    start(async () => {
      const res = await stockAdjustmentAction({ productId: product.id, delta, reason, note });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        return void toast.error(res.error);
      }
      toast.success(
        res.data.loss
          ? `Ajuste registrado. Despesa de ${formatBRL(res.data.loss)} lançada no financeiro.`
          : `Ajuste registrado. Estoque: ${formatQty(res.data.stockQty)}`,
      );
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Ajustar estoque</DialogTitle>
        <DialogDescription>
          {product.name} · estoque atual {formatQty(product.stockQty)}
        </DialogDescription>
      </DialogHeader>
      <Field id="adj-reason" label="Motivo" required>
        <NativeSelect value={reason} onChange={(e) => setReason(e.target.value as AdjustmentReason)}>
          {Object.entries(ADJUSTMENT_REASONS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </NativeSelect>
      </Field>
      <div className="grid grid-cols-2 gap-4">
        {canAdd ? (
          <Field id="adj-direction" label="Tipo">
            <NativeSelect value={direction} onChange={(e) => setDirection(e.target.value as "out" | "in")}>
              <option value="out">Retirar do estoque</option>
              <option value="in">Acrescentar ao estoque</option>
            </NativeSelect>
          </Field>
        ) : (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">Tipo</p>
            <p className="flex h-9 items-center text-sm text-muted-foreground">Retirar do estoque</p>
          </div>
        )}
        <Field id="adj-qty" label="Quantidade" required error={errors.delta}>
          <Input inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
        </Field>
      </div>
      <Field id="adj-note" label="Observação">
        <Input name="note" maxLength={200} />
      </Field>
      {seeCost && loss !== null && loss > 0 && (
        <p className="rounded-md bg-warning/15 px-3 py-2 text-sm text-warning-foreground">
          Vai lançar uma despesa de <strong className="tabular-nums">{formatBRL(loss.toFixed(2))}</strong> (quantidade × custo médio).
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Registrar ajuste
        </Button>
      </DialogFooter>
    </form>
  );
}

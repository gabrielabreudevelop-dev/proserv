"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { todayISO } from "@/lib/finance-shared";
import { formatBRL, parseDecimalInput } from "@/lib/format";
import { createExpenseAction, reverseExpenseAction } from "@/server/actions/finance";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/ui/form-controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export function ExpenseButton({ categories }: { categories: string[] }) {
  const [open, setOpen] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = { amount: fd.get("amount"), category: fd.get("category"), description: fd.get("description"), date: fd.get("date") };
    start(async () => {
      const res = await createExpenseAction(payload);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        return void toast.error(res.error);
      }
      toast.success(`Despesa de ${formatBRL(parseDecimalInput(payload.amount) ?? 0)} lançada`);
      setErrors({});
      setOpen(false);
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus /> Lançar despesa
      </Button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) setErrors({});
        }}
      >
        <DialogContent>
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>Lançar despesa</DialogTitle>
              <DialogDescription>Entra no resultado do mês da data escolhida.</DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4">
              <Field id="exp-amount" label="Valor (R$)" required error={errors.amount}>
                <Input name="amount" inputMode="decimal" placeholder="0,00" autoFocus />
              </Field>
              <Field id="exp-date" label="Data" required error={errors.date}>
                <Input name="date" type="date" defaultValue={todayISO()} max={todayISO()} />
              </Field>
            </div>
            <Field id="exp-category" label="Categoria" required error={errors.category}>
              <NativeSelect name="category" defaultValue="">
                <option value="" disabled>
                  Selecione…
                </option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </NativeSelect>
            </Field>
            <Field id="exp-description" label="Descrição" required error={errors.description}>
              <Input name="description" maxLength={200} placeholder="Ex.: aluguel de outubro" />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" />} Lançar despesa
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function ReverseExpenseButton({ id, description }: { id: string; description: string }) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)} aria-label={`Estornar ${description}`}>
        <Undo2 /> Estornar
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Estornar esta despesa?</DialogTitle>
            <DialogDescription>
              &quot;{description}&quot; continua no histórico, e um estorno de mesmo valor é lançado hoje. Use quando a despesa foi lançada por engano.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Voltar
            </Button>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  const res = await reverseExpenseAction(id);
                  if (!res.ok) return void toast.error(res.error);
                  toast.success("Despesa estornada");
                  setOpen(false);
                })
              }
            >
              {pending && <Loader2 className="animate-spin" />} Estornar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

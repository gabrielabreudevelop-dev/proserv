"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import type { FieldDef } from "@/lib/custom-fields";
import type { ProductRow } from "@/server/services/products";
import { createProductAction, updateProductAction } from "@/server/actions/products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox, Field, NativeSelect } from "@/components/ui/form-controls";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";

type State = { mode: "create" } | { mode: "edit"; product: ProductRow } | null;

/** Número vindo do banco ("3.5") exibido no padrão brasileiro ("3,5") para edição. */
const toInput = (v: string | number | null | undefined) => (v === null || v === undefined ? "" : String(v).replace(".", ","));

function CustomInput({ def, value, error }: { def: FieldDef; value: unknown; error?: string }) {
  const id = `custom-${def.key}`;
  const name = `custom.${def.key}`;
  if (def.type === "BOOLEAN") {
    return (
      <div className="space-y-1.5">
        <label htmlFor={id} className="flex items-center gap-2 text-sm font-medium">
          <Checkbox id={id} name={name} defaultChecked={value === true} />
          {def.label}
        </label>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </div>
    );
  }
  return (
    <Field id={id} label={def.label} required={def.required} error={error}>
      {def.type === "SELECT" ? (
        <NativeSelect name={name} defaultValue={value === undefined ? "" : String(value)}>
          <option value="">{def.required ? "Selecione…" : "—"}</option>
          {def.options.map((o) => (
            <option key={o} value={o}>
              {o}
            </option>
          ))}
        </NativeSelect>
      ) : def.type === "DATE" ? (
        <Input type="date" name={name} defaultValue={value === undefined ? "" : String(value)} />
      ) : def.type === "NUMBER" ? (
        <Input name={name} inputMode="decimal" defaultValue={toInput(value as number | undefined)} />
      ) : (
        <Input name={name} maxLength={200} defaultValue={value === undefined ? "" : String(value)} />
      )}
    </Field>
  );
}

export function ProductFormSheet({
  state,
  onClose,
  fields,
  categories,
  canSetInitialStock,
}: {
  state: State;
  onClose: () => void;
  fields: FieldDef[];
  categories: string[];
  canSetInitialStock: boolean;
}) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const product = state?.mode === "edit" ? state.product : null;
  const isCreate = state?.mode === "create";

  function close() {
    setErrors({});
    onClose();
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const customFields: Record<string, unknown> = {};
    for (const def of fields) {
      const raw = fd.get(`custom.${def.key}`);
      customFields[def.key] = def.type === "BOOLEAN" ? raw === "on" : (raw ?? "");
    }
    const payload = {
      sku: fd.get("sku"),
      name: fd.get("name"),
      category: fd.get("category"),
      salePrice: fd.get("salePrice"),
      minStock: fd.get("minStock"),
      customFields,
      ...(isCreate ? { initialQty: fd.get("initialQty") ?? "", initialCost: fd.get("initialCost") ?? "" } : {}),
    };

    startTransition(async () => {
      const res = product ? await updateProductAction(product.id, payload) : await createProductAction(payload);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        toast.error(res.error);
        return;
      }
      toast.success(product ? "Produto atualizado" : "Produto cadastrado");
      close();
    });
  }

  const err = (k: string) => errors[k];

  return (
    <Sheet open={state !== null} onOpenChange={(open) => !open && close()}>
      <SheetContent className="sm:max-w-xl">
        {state && (
          <form onSubmit={onSubmit} className="flex h-full flex-col" noValidate>
            <SheetHeader>
              <SheetTitle>{product ? "Editar produto" : "Novo produto"}</SheetTitle>
              <SheetDescription>
                {product ? `${product.sku} · ${product.name}` : "Só SKU, nome e preço são obrigatórios."}
              </SheetDescription>
            </SheetHeader>

            <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
              <div className="grid grid-cols-[10rem_1fr] gap-4">
                <Field id="sku" label="SKU" required error={err("sku")}>
                  <Input name="sku" defaultValue={product?.sku} autoFocus={!product} className="font-mono uppercase" maxLength={40} />
                </Field>
                <Field id="name" label="Nome" required error={err("name")}>
                  <Input name="name" defaultValue={product?.name} maxLength={120} />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-4">
                <Field id="category" label="Categoria" hint="Digite para criar uma nova" error={err("category")} className="col-span-1">
                  <Input name="category" list="categorias" defaultValue={product?.category ?? ""} maxLength={60} />
                </Field>
                <Field id="salePrice" label="Preço de venda (R$)" required error={err("salePrice")}>
                  <Input name="salePrice" inputMode="decimal" placeholder="0,00" defaultValue={toInput(product?.salePrice)} />
                </Field>
                <Field id="minStock" label="Estoque mínimo" hint="Gera alerta" error={err("minStock")}>
                  <Input name="minStock" inputMode="decimal" defaultValue={toInput(product?.minStock)} />
                </Field>
              </div>
              <datalist id="categorias">
                {categories.map((c) => (
                  <option key={c} value={c} />
                ))}
              </datalist>

              {isCreate && canSetInitialStock && (
                <fieldset className="space-y-3 rounded-lg border p-4">
                  <legend className="px-1 text-sm font-medium">Estoque inicial (opcional)</legend>
                  <div className="grid grid-cols-2 gap-4">
                    <Field id="initialQty" label="Quantidade" error={err("initialQty")}>
                      <Input name="initialQty" inputMode="decimal" />
                    </Field>
                    <Field id="initialCost" label="Custo unitário (R$)" hint="Vira o custo médio" error={err("initialCost")}>
                      <Input name="initialCost" inputMode="decimal" placeholder="0,00" />
                    </Field>
                  </div>
                </fieldset>
              )}

              {fields.length > 0 && (
                <fieldset className="space-y-4">
                  <legend className="mb-3 text-sm font-medium">Campos personalizados</legend>
                  <div className="grid grid-cols-2 gap-4">
                    {fields.map((def) => (
                      <CustomInput key={def.id} def={def} value={product?.customFields[def.key]} error={err(`custom.${def.key}`) ?? err(`customFields.${def.key}`)} />
                    ))}
                  </div>
                </fieldset>
              )}
            </div>

            <SheetFooter>
              <Button type="button" variant="outline" onClick={close}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}
                {product ? "Salvar alterações" : "Cadastrar produto"}
              </Button>
            </SheetFooter>
          </form>
        )}
      </SheetContent>
    </Sheet>
  );
}

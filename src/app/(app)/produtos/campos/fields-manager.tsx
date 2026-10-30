"use client";

import { useState, useTransition } from "react";
import { Archive, ArchiveRestore, ArrowDown, ArrowUp, Loader2, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { FIELD_TYPE_LABELS, FIELD_TYPES, type FieldDef, type FieldTypeName } from "@/lib/custom-fields";
import { cn } from "@/lib/utils";
import { archiveFieldAction, createFieldAction, moveFieldAction, updateFieldAction } from "@/server/actions/custom-fields";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox, Field, NativeSelect, Textarea } from "@/components/ui/form-controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Editing = { mode: "create" } | { mode: "edit"; field: FieldDef } | null;

export function FieldsManager({ fields, usage }: { fields: FieldDef[]; usage: Record<string, number> }) {
  const [editing, setEditing] = useState<Editing>(null);
  const [pending, start] = useTransition();
  const active = fields.filter((f) => !f.archived);
  const archived = fields.filter((f) => f.archived);

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, success?: string) {
    start(async () => {
      const res = await fn();
      if (!res.ok) toast.error(res.error ?? "Não foi possível concluir.");
      else if (success) toast.success(success);
    });
  }

  return (
    <div className="space-y-8">
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium">
            Campos ativos <span className="text-muted-foreground">· {active.length}</span>
          </h2>
          <Button onClick={() => setEditing({ mode: "create" })}>
            <Plus /> Novo campo
          </Button>
        </div>

        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-20">Ordem</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Regras</TableHead>
                <TableHead className="text-right">Produtos com valor</TableHead>
                <TableHead className="w-28 text-right">
                  <span className="sr-only">Ações</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {active.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={6} className="h-28 text-center text-muted-foreground">
                    Nenhum campo ainda. Crie o primeiro, por exemplo &quot;Vencimento&quot; do tipo Data.
                  </TableCell>
                </TableRow>
              )}
              {active.map((f, i) => (
                <TableRow key={f.id}>
                  <TableCell>
                    <div className="flex gap-0.5">
                      <Button variant="ghost" size="icon" className="size-7" disabled={i === 0 || pending} onClick={() => run(() => moveFieldAction(f.id, "up"))} aria-label={`Mover ${f.label} para cima`}>
                        <ArrowUp className="size-3.5" />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-7" disabled={i === active.length - 1 || pending} onClick={() => run(() => moveFieldAction(f.id, "down"))} aria-label={`Mover ${f.label} para baixo`}>
                        <ArrowDown className="size-3.5" />
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <span className="font-medium">{f.label}</span>
                    <span className="ml-2 font-mono text-xs text-muted-foreground">{f.key}</span>
                  </TableCell>
                  <TableCell>
                    {FIELD_TYPE_LABELS[f.type]}
                    {f.type === "SELECT" && <span className="ml-1 text-muted-foreground">({f.options.join(", ")})</span>}
                  </TableCell>
                  <TableCell>
                    <div className="flex gap-1">
                      {f.required && <Badge variant="secondary">Obrigatório</Badge>}
                      <Badge variant="outline" className={cn(!f.visibleByDefault && "text-muted-foreground")}>
                        {f.visibleByDefault ? "Visível por padrão" : "Oculto por padrão"}
                      </Badge>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{usage[f.key] ?? 0}</TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing({ mode: "edit", field: f })} aria-label={`Editar ${f.label}`}>
                      <Pencil />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-8"
                      disabled={pending}
                      onClick={() => run(() => archiveFieldAction(f.id, true), `"${f.label}" arquivado. Os valores continuam salvos.`)}
                      aria-label={`Arquivar ${f.label}`}
                    >
                      <Archive />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        <p className="text-xs text-muted-foreground">
          A ordem aqui é a ordem das colunas na tabela de produtos. Cada pessoa ainda pode ocultar as colunas que não usa.
        </p>
      </section>

      {archived.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Arquivados · {archived.length}</h2>
          <ul className="divide-y rounded-xl border">
            {archived.map((f) => (
              <li key={f.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <span>
                  <span className="text-muted-foreground">{f.label}</span>
                  <span className="ml-2 text-xs text-muted-foreground">
                    {FIELD_TYPE_LABELS[f.type]} · {usage[f.key] ?? 0} produtos com valor guardado
                  </span>
                </span>
                <Button variant="ghost" size="sm" disabled={pending} onClick={() => run(() => archiveFieldAction(f.id, false), `"${f.label}" restaurado`)}>
                  <ArchiveRestore /> Restaurar
                </Button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <FieldDialog editing={editing} onClose={() => setEditing(null)} />
    </div>
  );
}

function FieldDialog({ editing, onClose }: { editing: Editing; onClose: () => void }) {
  const field = editing?.mode === "edit" ? editing.field : null;
  const [type, setType] = useState<FieldTypeName>("TEXT");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const currentType = field?.type ?? type;

  function close() {
    setErrors({});
    setType("TEXT");
    onClose();
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      label: fd.get("label"),
      type: currentType,
      options: fd.get("options") ?? "",
      required: fd.get("required") === "on",
      visibleByDefault: fd.get("visibleByDefault") === "on",
    };
    start(async () => {
      const res = field ? await updateFieldAction(field.id, payload) : await createFieldAction(payload);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        return void toast.error(res.error);
      }
      toast.success(field ? "Campo atualizado" : `Campo "${res.data.label}" criado — já aparece na tabela`);
      close();
    });
  }

  return (
    <Dialog open={editing !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent>
        {editing && (
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>{field ? `Editar "${field.label}"` : "Novo campo"}</DialogTitle>
              <DialogDescription>
                {field ? "O tipo não muda depois de criado, para não invalidar valores já salvos." : "O campo aparece no cadastro e como coluna na tabela."}
              </DialogDescription>
            </DialogHeader>
            <div className="grid grid-cols-2 gap-4">
              <Field id="field-label" label="Nome" required error={errors.label}>
                <Input name="label" defaultValue={field?.label} placeholder="Ex.: Vencimento" maxLength={40} autoFocus />
              </Field>
              <Field id="field-type" label="Tipo" required>
                <NativeSelect value={currentType} onChange={(e) => setType(e.target.value as FieldTypeName)} disabled={Boolean(field)}>
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {FIELD_TYPE_LABELS[t]}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            {currentType === "SELECT" && (
              <Field id="field-options" label="Opções" required hint="Uma por linha ou separadas por vírgula" error={errors.options}>
                <Textarea name="options" defaultValue={field?.options.join("\n")} rows={4} placeholder={"Azul\nVerde\nPreto"} />
              </Field>
            )}
            <div className="flex flex-col gap-2.5">
              <label className="flex items-center gap-2 text-sm">
                <Checkbox name="required" defaultChecked={field?.required ?? false} /> Obrigatório no cadastro
              </label>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox name="visibleByDefault" defaultChecked={field?.visibleByDefault ?? true} /> Mostrar como coluna por padrão
              </label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}
                {field ? "Salvar" : "Criar campo"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

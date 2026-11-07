"use client";

import { useState, useTransition } from "react";
import { Loader2, Pencil, Plus, Power } from "lucide-react";
import { toast } from "sonner";
import { formatBRL, formatPct } from "@/lib/format";
import { formatDuration } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { ServiceRow } from "@/server/services/catalog";
import { createServiceAction, setServiceActiveAction, updateServiceAction } from "@/server/actions/services";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect } from "@/components/ui/form-controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Perms = { manage: boolean; seeCost: boolean };
type Editing = { mode: "create" } | { mode: "edit"; service: ServiceRow } | null;

const DURATIONS = [15, 30, 45, 60, 90, 120, 150, 180, 240];
const toInput = (v?: string) => (v === undefined ? "" : v.replace(".", ","));

export function ServicesManager({ services, perms }: { services: ServiceRow[]; perms: Perms }) {
  const [editing, setEditing] = useState<Editing>(null);
  const [, start] = useTransition();

  function toggle(s: ServiceRow) {
    start(async () => {
      const res = await setServiceActiveAction(s.id, !s.active);
      if (!res.ok) return void toast.error(res.error);
      toast.success(s.active ? `"${s.name}" desativado — some da agenda para novos horários` : `"${s.name}" reativado`);
    });
  }

  return (
    <div className="space-y-4">
      {perms.manage && (
        <div className="flex justify-end">
          <Button onClick={() => setEditing({ mode: "create" })}>
            <Plus /> Novo serviço
          </Button>
        </div>
      )}
      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Serviço</TableHead>
              <TableHead>Duração</TableHead>
              <TableHead className="text-right">Valor</TableHead>
              {perms.seeCost && <TableHead className="text-right">Custo estimado</TableHead>}
              {perms.seeCost && <TableHead className="text-right">Margem</TableHead>}
              <TableHead>Retorno</TableHead>
              <TableHead className="text-right">Atendimentos</TableHead>
              {perms.manage && (
                <TableHead className="w-24">
                  <span className="sr-only">Ações</span>
                </TableHead>
              )}
            </TableRow>
          </TableHeader>
          <TableBody>
            {services.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={8} className="h-28 text-center text-muted-foreground">
                  Nenhum serviço cadastrado.
                </TableCell>
              </TableRow>
            )}
            {services.map((s) => {
              const price = Number(s.price);
              const cost = Number(s.estimatedCost ?? 0);
              const margin = price > 0 ? (price - cost) / price : null;
              return (
                <TableRow key={s.id} className={cn(!s.active && "opacity-60")}>
                  <TableCell className="whitespace-normal">
                    <span className="flex items-center gap-2 font-medium">
                      {s.name}
                      {!s.active && <Badge variant="outline">Inativo</Badge>}
                    </span>
                    {s.description && <span className="text-xs text-muted-foreground">{s.description}</span>}
                  </TableCell>
                  <TableCell className="tabular-nums">{formatDuration(s.durationMin)}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums">{formatBRL(s.price)}</TableCell>
                  {perms.seeCost && <TableCell className="text-right tabular-nums text-muted-foreground">{formatBRL(cost)}</TableCell>}
                  {perms.seeCost && (
                    <TableCell className={cn("text-right tabular-nums", margin !== null && margin < 0 && "font-medium text-destructive")}>
                      {margin === null ? "—" : formatPct(margin)}
                    </TableCell>
                  )}
                  <TableCell className="whitespace-normal text-sm">
                    {s.returnAfterMonths ? (
                      <>
                        {monthsLabel(s.returnAfterMonths)}
                        <span className="block text-xs text-muted-foreground">{s.returnServiceName ?? "Mesmo serviço"}</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{s.appointmentsCount}</TableCell>
                  {perms.manage && (
                    <TableCell className="py-1 text-right">
                      <Button variant="ghost" size="icon" className="size-8" onClick={() => setEditing({ mode: "edit", service: s })} aria-label={`Editar ${s.name}`}>
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon" className="size-8" onClick={() => toggle(s)} aria-label={s.active ? `Desativar ${s.name}` : `Reativar ${s.name}`}>
                        <Power />
                      </Button>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {perms.seeCost && (
        <p className="text-xs text-muted-foreground">
          O custo estimado (insumos, comissão) entra como despesa toda vez que um atendimento é concluído.
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Com retorno configurado, concluir um atendimento já programa quando voltar a falar com o cliente (tela Retornos).
      </p>
      <ServiceDialog editing={editing} onClose={() => setEditing(null)} services={services} />
    </div>
  );
}

const RETURN_MONTHS = [1, 2, 3, 4, 6, 9, 12, 18, 24];
const monthsLabel = (m: number) => (m === 1 ? "Em 1 mês" : `Em ${m} meses`);

function ServiceDialog({ editing, onClose, services }: { editing: Editing; onClose: () => void; services: ServiceRow[] }) {
  const service = editing?.mode === "edit" ? editing.service : null;
  return (
    <Dialog open={editing !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>{editing && <ServiceForm key={service?.id ?? "new"} service={service} onClose={onClose} services={services} />}</DialogContent>
    </Dialog>
  );
}

function ServiceForm({ service, onClose, services }: { service: ServiceRow | null; onClose: () => void; services: ServiceRow[] }) {
  const [months, setMonths] = useState(service?.returnAfterMonths ? String(service.returnAfterMonths) : "");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  function close() {
    setErrors({});
    onClose();
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = {
      name: fd.get("name"),
      description: fd.get("description"),
      price: fd.get("price"),
      estimatedCost: fd.get("estimatedCost"),
      durationMin: fd.get("durationMin"),
      returnAfterMonths: fd.get("returnAfterMonths"),
      returnServiceId: fd.get("returnServiceId") ?? "",
    };
    start(async () => {
      const res = service ? await updateServiceAction(service.id, payload) : await createServiceAction(payload);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        return void toast.error(res.error);
      }
      if (res.data.warning) toast.warning(res.data.warning);
      toast.success(service ? "Serviço atualizado" : "Serviço cadastrado");
      close();
    });
  }

  const durations = service && !DURATIONS.includes(service.durationMin) ? [...DURATIONS, service.durationMin].sort((a, b) => a - b) : DURATIONS;
  const monthOptions = service?.returnAfterMonths && !RETURN_MONTHS.includes(service.returnAfterMonths) ? [...RETURN_MONTHS, service.returnAfterMonths].sort((a, b) => a - b) : RETURN_MONTHS;
  const targets = services.filter((x) => x.active && x.id !== service?.id);

  return (
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>{service ? "Editar serviço" : "Novo serviço"}</DialogTitle>
              <DialogDescription>
                {service ? "Mudanças valem para novos agendamentos e conclusões." : "Aparece na agenda assim que for salvo."}
              </DialogDescription>
            </DialogHeader>
            <Field id="svc-name" label="Nome" required error={errors.name}>
              <Input name="name" defaultValue={service?.name} maxLength={80} autoFocus />
            </Field>
            <Field id="svc-description" label="Descrição" error={errors.description}>
              <Input name="description" defaultValue={service?.description ?? ""} maxLength={200} />
            </Field>
            <div className="grid grid-cols-3 gap-4">
              <Field id="svc-duration" label="Duração" required error={errors.durationMin}>
                <NativeSelect name="durationMin" defaultValue={service?.durationMin ?? 60}>
                  {durations.map((d) => (
                    <option key={d} value={d}>
                      {formatDuration(d)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              <Field id="svc-price" label="Valor (R$)" required error={errors.price}>
                <Input name="price" inputMode="decimal" placeholder="0,00" defaultValue={toInput(service?.price)} />
              </Field>
              <Field id="svc-cost" label="Custo estimado (R$)" hint="Insumos, comissão" error={errors.estimatedCost}>
                <Input name="estimatedCost" inputMode="decimal" placeholder="0,00" defaultValue={toInput(service?.estimatedCost)} />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="svc-return" label="Retorno" hint="Quando voltar a falar com o cliente" error={errors.returnAfterMonths}>
                <NativeSelect name="returnAfterMonths" value={months} onChange={(e) => setMonths(e.target.value)}>
                  <option value="">Sem retorno</option>
                  {monthOptions.map((m) => (
                    <option key={m} value={m}>
                      {monthsLabel(m)}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
              {months && (
                <Field id="svc-return-service" label="Oferecer no retorno" error={errors.returnServiceId}>
                  <NativeSelect name="returnServiceId" defaultValue={service?.returnServiceId ?? ""}>
                    <option value="">O mesmo serviço</option>
                    {targets.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                  </NativeSelect>
                </Field>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}
                {service ? "Salvar" : "Cadastrar serviço"}
              </Button>
            </DialogFooter>
          </form>
  );
}

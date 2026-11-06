"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CalendarPlus, GitMerge, Loader2, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatPhone } from "@/lib/phone";
import { localParts, minutesToTime, AGENDA_END_HOUR, AGENDA_START_HOUR, SLOT_MINUTES } from "@/lib/time";
import type { CustomerOption, ProviderOption } from "@/server/services/catalog";
import { createCustomerAction, eraseCustomerAction, mergeCustomersAction, updateCustomerAction } from "@/server/actions/customers";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, Textarea } from "@/components/ui/form-controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { ScheduleDialog, customerLabel, type ScheduleDraft, type ServiceOption } from "../agenda/schedule-dialog";

export type EditableCustomer = { id: string; name: string; phone: string | null; email: string | null; notes: string | null };

// ── Novo / editar ────────────────────────────────────────
export function NewCustomerButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus /> Novo cliente
      </Button>
      <CustomerFormDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}

function CustomerFormDialog({ open, onClose, customer }: { open: boolean; onClose: () => void; customer?: EditableCustomer }) {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const router = useRouter();

  function close() {
    setErrors({});
    onClose();
  }

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const payload = { name: fd.get("name"), phone: fd.get("phone"), email: fd.get("email"), notes: fd.get("notes") };
    start(async () => {
      const res = customer ? await updateCustomerAction(customer.id, payload) : await createCustomerAction(payload);
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        return void toast.error(res.error);
      }
      if (res.data.warning) toast.warning(res.data.warning);
      toast.success(customer ? "Cliente atualizado" : "Cliente cadastrado");
      close();
      if (!customer && "id" in res.data) router.push(`/clientes/${res.data.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        {open && (
          <form onSubmit={submit} className="grid gap-4" noValidate>
            <DialogHeader>
              <DialogTitle>{customer ? "Editar cliente" : "Novo cliente"}</DialogTitle>
              <DialogDescription>{customer ? "As mudanças aparecem na agenda e no histórico." : "Também dá para cadastrar direto ao agendar."}</DialogDescription>
            </DialogHeader>
            <Field id="cus-name" label="Nome" required error={errors.name}>
              <Input name="name" defaultValue={customer?.name} maxLength={80} autoFocus autoComplete="off" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="cus-phone" label="Telefone" hint="Com DDD" error={errors.phone}>
                <Input name="phone" defaultValue={formatPhone(customer?.phone)} inputMode="tel" placeholder="(11) 90000-0000" maxLength={20} autoComplete="off" />
              </Field>
              <Field id="cus-email" label="E-mail" error={errors.email}>
                <Input name="email" type="email" defaultValue={customer?.email ?? ""} maxLength={120} autoComplete="off" />
              </Field>
            </div>
            <Field id="cus-notes" label="Observações" hint="Preferências e o que ajuda no atendimento" error={errors.notes}>
              <Textarea name="notes" rows={3} maxLength={500} defaultValue={customer?.notes ?? ""} placeholder="Ex.: prefere horários pela manhã; portão lateral" />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" />}
                {customer ? "Salvar" : "Cadastrar cliente"}
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Ações da ficha ───────────────────────────────────────
const TIMES = Array.from({ length: ((AGENDA_END_HOUR - AGENDA_START_HOUR) * 60) / SLOT_MINUTES }, (_, i) => minutesToTime(AGENDA_START_HOUR * 60 + i * SLOT_MINUTES));

/** Próximo horário cheio ou meia hora, dentro do expediente da agenda. */
function nextSlot() {
  const { date, minutes } = localParts(new Date());
  const t = TIMES.find((x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3)) > minutes);
  return t ? { date, time: t } : { date: localParts(new Date(Date.now() + 86_400_000)).date, time: "09:00" };
}

type Dialogs = "edit" | "merge" | "erase" | null;

export function CustomerActions({
  customer,
  manage,
  schedule,
  others,
}: {
  customer: EditableCustomer;
  manage: boolean;
  /** Dados para agendar a partir da ficha (só quem pode agendar). */
  schedule: { services: ServiceOption[]; providers: ProviderOption[]; favoriteServiceId?: string } | null;
  others: CustomerOption[];
}) {
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
  const router = useRouter();

  return (
    <>
      {schedule && schedule.providers.length > 0 && schedule.services.length > 0 && (
        <Button onClick={() => setDraft({ ...nextSlot(), providerId: schedule.providers[0].id })}>
          <CalendarPlus /> Agendar
        </Button>
      )}
      {manage && (
        <>
          <Button variant="outline" onClick={() => setDialog("edit")}>
            <Pencil /> Editar
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon" aria-label="Mais ações do cliente">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem onSelect={() => setDialog("merge")}>
                <GitMerge /> Juntar com outro cadastro
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onSelect={() => setDialog("erase")}>
                <Trash2 /> Excluir dados pessoais
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      )}

      {schedule && (
        <ScheduleDialog
          draft={draft}
          onClose={() => {
            setDraft(null);
            router.refresh();
          }}
          services={schedule.services}
          providers={schedule.providers}
          customers={[]}
          appointments={[]}
          presetCustomer={{ id: customer.id, name: customer.name, phone: customer.phone }}
          presetServiceId={schedule.favoriteServiceId}
        />
      )}
      <CustomerFormDialog open={dialog === "edit"} onClose={() => setDialog(null)} customer={customer} />
      <MergeDialog open={dialog === "merge"} onClose={() => setDialog(null)} customer={customer} others={others} />
      <EraseDialog open={dialog === "erase"} onClose={() => setDialog(null)} customer={customer} />
    </>
  );
}

function MergeDialog({ open, onClose, customer, others }: { open: boolean; onClose: () => void; customer: EditableCustomer; others: CustomerOption[] }) {
  const [text, setText] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const target = others.find((o) => customerLabel(o) === text);

  function close() {
    setText("");
    onClose();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!target) return;
    start(async () => {
      const res = await mergeCustomersAction({ sourceId: customer.id, targetId: target.id });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Cadastros juntados em ${res.data.targetName}`);
      close();
      router.replace(`/clientes/${target.id}`);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Juntar com outro cadastro</DialogTitle>
            <DialogDescription>
              Use quando a mesma pessoa foi cadastrada duas vezes. Os atendimentos e compras de <strong>{customer.name}</strong> passam para o cadastro escolhido, e
              este deixa de existir. Telefone, e-mail e observações que faltarem no escolhido são aproveitados.
            </DialogDescription>
          </DialogHeader>
          <Field id="merge-target" label="Cadastro que fica" required hint={text && !target ? "Escolha um cliente da lista" : undefined}>
            <Input value={text} onChange={(e) => setText(e.target.value)} list="merge-options" autoComplete="off" placeholder="Digite o nome" autoFocus />
          </Field>
          <datalist id="merge-options">
            {others.map((o) => (
              <option key={o.id} value={customerLabel(o)} />
            ))}
          </datalist>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancelar
            </Button>
            <Button type="submit" disabled={!target || pending}>
              {pending && <Loader2 className="animate-spin" />} Juntar cadastros
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EraseDialog({ open, onClose, customer }: { open: boolean; onClose: () => void; customer: EditableCustomer }) {
  const [typed, setTyped] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const matches = typed.trim().toLowerCase() === customer.name.trim().toLowerCase();

  function close() {
    setTyped("");
    onClose();
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!matches) return;
    start(async () => {
      const res = await eraseCustomerAction(customer.id);
      if (!res.ok) return void toast.error(res.error);
      toast.success(res.data.deleted ? "Cadastro excluído" : "Dados pessoais apagados. O histórico ficou sem identificação.");
      close();
      if (res.data.deleted) router.replace("/clientes");
      else router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <form onSubmit={submit} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Excluir dados pessoais</DialogTitle>
            <DialogDescription>
              Para atender um pedido do cliente (LGPD). Nome, telefone, e-mail e observações são apagados, inclusive dos atendimentos e do registro de auditoria.
              Datas e valores ficam, sem identificação, porque fazem parte da contabilidade. Não dá para desfazer.
            </DialogDescription>
          </DialogHeader>
          <Field id="erase-confirm" label={`Digite "${customer.name}" para confirmar`} required>
            <Input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" autoFocus />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>
              Cancelar
            </Button>
            <Button type="submit" variant="destructive" disabled={!matches || pending}>
              {pending && <Loader2 className="animate-spin" />} Excluir dados
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

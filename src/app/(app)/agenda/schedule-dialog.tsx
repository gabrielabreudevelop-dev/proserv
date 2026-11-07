"use client";

import { useState, useTransition } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { formatBRL } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { AGENDA_END_HOUR, AGENDA_START_HOUR, SLOT_MINUTES, atLocal, formatDuration, localParts, minutesToTime } from "@/lib/time";
import type { AppointmentRow } from "@/server/services/appointments";
import type { CustomerOption, ProviderOption } from "@/server/services/catalog";
import { scheduleAction } from "@/server/actions/services";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect, Textarea } from "@/components/ui/form-controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export type ServiceOption = { id: string; name: string; durationMin: number; price: string };
export type ScheduleDraft = { date: string; time: string; providerId: string };

const TIMES = Array.from({ length: ((AGENDA_END_HOUR - AGENDA_START_HOUR) * 60) / SLOT_MINUTES }, (_, i) => minutesToTime(AGENDA_START_HOUR * 60 + i * SLOT_MINUTES));
export const customerLabel = (c: CustomerOption) => (c.phone ? `${c.name} · ${formatPhone(c.phone)}` : c.name);

export function ScheduleDialog({
  draft,
  onClose,
  services,
  providers,
  customers,
  appointments,
  presetCustomer,
  presetServiceId,
  followUpId,
}: {
  draft: ScheduleDraft | null;
  onClose: () => void;
  services: ServiceOption[];
  providers: ProviderOption[];
  customers: CustomerOption[];
  appointments: AppointmentRow[];
  /** Agendamento aberto pela ficha do cliente: já vem preenchido. */
  presetCustomer?: CustomerOption;
  /** Serviço que já vem escolhido (ex.: o preferido do cliente). */
  presetServiceId?: string;
  /** Agendamento aberto por um retorno: o atendimento fica ligado a ele. */
  followUpId?: string;
}) {
  return (
    <Dialog open={draft !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        {draft && <ScheduleForm key={`${draft.date}${draft.time}${draft.providerId}`} draft={draft} onClose={onClose} services={services} providers={providers} customers={customers} appointments={appointments} presetCustomer={presetCustomer} presetServiceId={presetServiceId} followUpId={followUpId} />}
      </DialogContent>
    </Dialog>
  );
}

function ScheduleForm({
  draft,
  onClose,
  services,
  providers,
  customers,
  appointments,
  presetCustomer,
  presetServiceId,
  followUpId,
}: {
  draft: ScheduleDraft;
  onClose: () => void;
  services: ServiceOption[];
  providers: ProviderOption[];
  customers: CustomerOption[];
  appointments: AppointmentRow[];
  presetCustomer?: CustomerOption;
  presetServiceId?: string;
  followUpId?: string;
}) {
  const [serviceId, setServiceId] = useState(services.find((s) => s.id === presetServiceId)?.id ?? services[0]?.id ?? "");
  const [providerId, setProviderId] = useState(draft.providerId);
  const [date, setDate] = useState(draft.date);
  const [time, setTime] = useState(TIMES.includes(draft.time) ? draft.time : "09:00");
  const [customerText, setCustomerText] = useState(presetCustomer ? customerLabel(presetCustomer) : "");
  const [phone, setPhone] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  const [openedAt] = useState(() => Date.now());

  const service = services.find((s) => s.id === serviceId);
  const existing = [...(presetCustomer ? [presetCustomer] : []), ...customers].find((c) => customerLabel(c) === customerText || c.name.toLowerCase() === customerText.trim().toLowerCase());
  const startsAt = atLocal(date, time);
  const endsAt = service ? new Date(startsAt.getTime() + service.durationMin * 60_000) : startsAt;

  // Aviso de choque antes de enviar (o servidor confere de novo, com trava).
  const clash = appointments.find(
    (a) => a.provider.id === providerId && a.status !== "CANCELADO" && new Date(a.startsAt) < endsAt && new Date(a.endsAt) > startsAt,
  );
  const pastStart = startsAt.getTime() < openedAt - 5 * 60_000;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const notes = new FormData(e.currentTarget).get("notes");
    start(async () => {
      const res = await scheduleAction({
        serviceId,
        providerId,
        date,
        time,
        ...(existing ? { customerId: existing.id } : { customerName: customerText, customerPhone: phone }),
        notes,
        followUpId,
      });
      if (!res.ok) {
        setErrors({ ...(res.fieldErrors ?? {}), ...(res.fieldErrors?.customer ? { customerName: res.fieldErrors.customer } : {}) });
        return void toast.error(res.error);
      }
      toast.success(`Agendado: ${service?.name} às ${time}`);
      onClose();
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4" noValidate>
      <DialogHeader>
        <DialogTitle>Agendar atendimento</DialogTitle>
        <DialogDescription>O horário de término vem da duração do serviço.</DialogDescription>
      </DialogHeader>

      <Field id="sch-service" label="Serviço" required error={errors.serviceId}>
        <NativeSelect value={serviceId} onChange={(e) => setServiceId(e.target.value)}>
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · {formatDuration(s.durationMin)} · {formatBRL(s.price)}
            </option>
          ))}
        </NativeSelect>
      </Field>

      <div className="grid grid-cols-[1fr_8rem_7rem] gap-4">
        <Field id="sch-provider" label="Prestador" required error={errors.providerId}>
          <NativeSelect value={providerId} onChange={(e) => setProviderId(e.target.value)}>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </NativeSelect>
        </Field>
        <Field id="sch-date" label="Data" required error={errors.date}>
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <Field id="sch-time" label="Início" required error={errors.time ?? errors.startsAt}>
          <NativeSelect value={time} onChange={(e) => setTime(e.target.value)}>
            {TIMES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </NativeSelect>
        </Field>
      </div>

      {service && (
        <p className="-mt-2 text-xs text-muted-foreground tabular-nums">
          Das {time} às {minutesToTime(Number(time.slice(0, 2)) * 60 + Number(time.slice(3)) + service.durationMin)}
        </p>
      )}

      <div className="grid grid-cols-[1fr_11rem] gap-4">
        <Field id="sch-customer" label="Cliente" required hint={existing ? "Cliente já cadastrado" : customerText ? "Novo cliente" : "Digite para buscar ou cadastrar"} error={errors.customerName}>
          <Input value={customerText} onChange={(e) => setCustomerText(e.target.value)} list="sch-customers" autoComplete="off" maxLength={80} />
        </Field>
        <Field id="sch-phone" label="Telefone" error={errors.customerPhone}>
          <Input value={existing ? formatPhone(existing.phone) : phone} onChange={(e) => setPhone(e.target.value)} disabled={Boolean(existing)} inputMode="tel" placeholder="(11) 90000-0000" maxLength={20} />
        </Field>
      </div>
      <datalist id="sch-customers">
        {customers.map((c) => (
          <option key={c.id} value={customerLabel(c)} />
        ))}
      </datalist>

      <Field id="sch-notes" label="Observações">
        <Textarea name="notes" rows={2} maxLength={300} placeholder="Endereço, ponto de referência, pedido do cliente…" />
      </Field>

      {clash && (
        <p role="alert" className="flex items-start gap-2 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          Choque com {clash.service.name} ({clash.customer.name}) nesse horário. Escolha outro horário ou prestador.
        </p>
      )}
      {!clash && pastStart && <p className="text-sm text-warning-foreground">Atenção: esse horário já passou.</p>}

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending || Boolean(clash) || !customerText.trim()}>
          {pending && <Loader2 className="animate-spin" />} Agendar
        </Button>
      </DialogFooter>
    </form>
  );
}

const SLOT_TIMES = Array.from({ length: ((AGENDA_END_HOUR - AGENDA_START_HOUR) * 60) / SLOT_MINUTES }, (_, i) => minutesToTime(AGENDA_START_HOUR * 60 + i * SLOT_MINUTES));

/** Próximo horário cheio ou meia hora, dentro do expediente da agenda. */
export function nextSlot() {
  const { date, minutes } = localParts(new Date());
  const t = SLOT_TIMES.find((x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3)) > minutes);
  return t ? { date, time: t } : { date: localParts(new Date(Date.now() + 86_400_000)).date, time: "09:00" };
}

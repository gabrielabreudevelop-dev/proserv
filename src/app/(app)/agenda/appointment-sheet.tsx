"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { CalendarClock, CheckCircle2, Loader2, Phone, Play, XCircle } from "lucide-react";
import { toast } from "sonner";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/finance-shared";
import { formatBRL, parseDecimalInput } from "@/lib/format";
import { AGENDA_END_HOUR, AGENDA_START_HOUR, SLOT_MINUTES, localParts, longDate, minutesToTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { formatPhone } from "@/lib/phone";
import type { AppointmentRow } from "@/server/services/appointments";
import type { ProviderOption } from "@/server/services/catalog";
import { cancelAppointmentAction, completeAppointmentAction, rescheduleAction, startAppointmentAction } from "@/server/actions/services";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect, Textarea } from "@/components/ui/form-controls";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { AgendaPerms } from "./agenda-view";

type Mode = "view" | "complete" | "reschedule" | "cancel";
const TIMES = Array.from({ length: ((AGENDA_END_HOUR - AGENDA_START_HOUR) * 60) / SLOT_MINUTES }, (_, i) => minutesToTime(AGENDA_START_HOUR * 60 + i * SLOT_MINUTES));

const STATUS: Record<AppointmentRow["status"], { label: string; cls: string }> = {
  AGENDADO: { label: "Agendado", cls: "" },
  EM_ANDAMENTO: { label: "Em andamento", cls: "bg-warning/25 text-warning-foreground border-transparent" },
  CONCLUIDO: { label: "Concluído", cls: "bg-success/15 text-success border-transparent" },
  CANCELADO: { label: "Cancelado", cls: "bg-destructive/10 text-destructive border-transparent" },
};

export function AppointmentSheet({
  appointment,
  onClose,
  perms,
  currentUserId,
  providers,
  now,
}: {
  appointment: AppointmentRow | null;
  onClose: () => void;
  perms: AgendaPerms;
  currentUserId: string;
  providers: ProviderOption[];
  now: Date | null;
}) {
  return (
    <Sheet open={appointment !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent>
        {appointment && <Body key={appointment.id + appointment.status} a={appointment} onClose={onClose} perms={perms} currentUserId={currentUserId} providers={providers} now={now} />}
      </SheetContent>
    </Sheet>
  );
}

function Body({ a, onClose, perms, currentUserId, providers, now }: { a: AppointmentRow; onClose: () => void; perms: AgendaPerms; currentUserId: string; providers: ProviderOption[]; now: Date | null }) {
  const [mode, setMode] = useState<Mode>("view");
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});

  const startP = localParts(new Date(a.startsAt));
  const endP = localParts(new Date(a.endsAt));
  const mine = a.provider.id === currentUserId;
  const canAct = perms.complete && (mine || perms.seeAll);
  const open = a.status === "AGENDADO" || a.status === "EM_ANDAMENTO";
  const late = open && now !== null && new Date(a.endsAt) < now;
  const tooEarly = now !== null && new Date(a.startsAt).getTime() - now.getTime() > 60 * 60_000;

  function run(fn: () => Promise<{ ok: true; data?: unknown } | { ok: false; error: string; fieldErrors?: Record<string, string> }>, success: string) {
    start(async () => {
      const res = await fn();
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        return void toast.error(res.error);
      }
      toast.success(success);
      onClose();
    });
  }

  return (
    <div className="flex h-full flex-col">
      <SheetHeader>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className={STATUS[a.status].cls}>
            {STATUS[a.status].label}
          </Badge>
          {late && <Badge className="border-transparent bg-destructive/10 text-destructive">Atrasado</Badge>}
        </div>
        <SheetTitle className="pt-1">{a.service.name}</SheetTitle>
        <SheetDescription className="tabular-nums">
          {longDate(startP.date)} · {startP.time} às {endP.time}
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 space-y-6 overflow-y-auto px-6 py-5">
        <dl className="grid grid-cols-[7rem_1fr] gap-y-3 text-sm">
          <dt className="text-muted-foreground">Cliente</dt>
          <dd className="font-medium">
            {perms.customers ? (
              <Link href={`/clientes/${a.customer.id}`} className="underline-offset-4 hover:underline">
                {a.customer.name}
              </Link>
            ) : (
              a.customer.name
            )}
          </dd>
          {a.customer.phone && (
            <>
              <dt className="text-muted-foreground">Telefone</dt>
              <dd>
                <a href={`tel:${a.customer.phone}`} className="inline-flex items-center gap-1.5 underline-offset-4 hover:underline">
                  <Phone className="size-3.5" /> {formatPhone(a.customer.phone)}
                </a>
              </dd>
            </>
          )}
          <dt className="text-muted-foreground">Prestador</dt>
          <dd>{mine ? `${a.provider.name} (você)` : a.provider.name}</dd>
          <dt className="text-muted-foreground">Valor</dt>
          <dd className="tabular-nums">{formatBRL(a.chargedPrice ?? a.service.price)}{a.chargedPrice && a.paymentMethod ? ` · ${a.paymentMethod}` : ""}</dd>
          {a.notes && (
            <>
              <dt className="text-muted-foreground">Observações</dt>
              <dd className="whitespace-pre-line">{a.notes}</dd>
            </>
          )}
          {a.cancelReason && (
            <>
              <dt className="text-muted-foreground">Motivo</dt>
              <dd className="text-destructive">{a.cancelReason}</dd>
            </>
          )}
        </dl>

        {mode === "complete" && <CompleteForm a={a} pending={pending} errors={errors} onCancel={() => setMode("view")} onSubmit={(p) => run(() => completeAppointmentAction({ id: a.id, ...p }), `Atendimento concluído · ${formatBRL(parseDecimalInput(p.chargedPrice) ?? a.service.price)} no caixa`)} />}

        {mode === "reschedule" && (
          <form
            className="space-y-4 rounded-lg border p-4"
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              run(() => rescheduleAction({ id: a.id, date: fd.get("date"), time: fd.get("time"), providerId: fd.get("providerId") || undefined }), "Atendimento remarcado");
            }}
          >
            <h3 className="text-sm font-medium">Remarcar</h3>
            <div className="grid grid-cols-2 gap-3">
              <Field id="rs-date" label="Data" error={errors.date}>
                <Input type="date" name="date" defaultValue={startP.date} />
              </Field>
              <Field id="rs-time" label="Início" error={errors.time ?? errors.startsAt}>
                <NativeSelect name="time" defaultValue={startP.time}>
                  {TIMES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            </div>
            {perms.seeAll && (
              <Field id="rs-provider" label="Prestador">
                <NativeSelect name="providerId" defaultValue={a.provider.id}>
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </NativeSelect>
              </Field>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setMode("view")}>
                Voltar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" />} Salvar novo horário
              </Button>
            </div>
          </form>
        )}

        {mode === "cancel" && (
          <form
            className="space-y-4 rounded-lg border border-destructive/30 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              const reason = new FormData(e.currentTarget).get("reason");
              run(() => cancelAppointmentAction({ id: a.id, reason }), a.status === "CONCLUIDO" ? "Atendimento cancelado e valores estornados" : "Atendimento cancelado");
            }}
          >
            <h3 className="text-sm font-medium">{a.status === "CONCLUIDO" ? "Cancelar e estornar" : "Cancelar atendimento"}</h3>
            {a.status === "CONCLUIDO" && <p className="text-sm text-muted-foreground">A receita e o custo deste atendimento serão estornados hoje no financeiro.</p>}
            <Field id="cx-reason" label="Motivo" required error={errors.reason}>
              <Textarea name="reason" rows={2} maxLength={200} autoFocus placeholder="Ex.: cliente remarcou, não estava em casa" />
            </Field>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setMode("view")}>
                Voltar
              </Button>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending && <Loader2 className="animate-spin" />} Confirmar cancelamento
              </Button>
            </div>
          </form>
        )}
      </div>

      {mode === "view" && (
        <SheetFooter className="flex-wrap justify-start">
          {canAct && a.status === "AGENDADO" && (
            <Button variant="outline" disabled={pending || tooEarly} title={tooEarly ? "Disponível 1 hora antes do horário" : undefined} onClick={() => run(() => startAppointmentAction(a.id), "Atendimento iniciado")}>
              <Play /> Iniciar
            </Button>
          )}
          {canAct && open && (
            <Button disabled={tooEarly} title={tooEarly ? "Disponível 1 hora antes do horário" : undefined} onClick={() => setMode("complete")}>
              <CheckCircle2 /> Concluir
            </Button>
          )}
          {perms.schedule && a.status === "AGENDADO" && (
            <Button variant="outline" onClick={() => setMode("reschedule")}>
              <CalendarClock /> Remarcar
            </Button>
          )}
          {((canAct && open) || (perms.seeAll && a.status === "CONCLUIDO")) && (
            <Button variant="ghost" className="ml-auto text-destructive hover:text-destructive" onClick={() => setMode("cancel")}>
              <XCircle /> {a.status === "CONCLUIDO" ? "Cancelar e estornar" : "Cancelar"}
            </Button>
          )}
          {tooEarly && canAct && open && <p className="w-full text-xs text-muted-foreground">Iniciar e concluir ficam disponíveis 1 hora antes do horário.</p>}
        </SheetFooter>
      )}
    </div>
  );
}

function CompleteForm({
  a,
  pending,
  errors,
  onCancel,
  onSubmit,
}: {
  a: AppointmentRow;
  pending: boolean;
  errors: Record<string, string>;
  onCancel: () => void;
  onSubmit: (p: { chargedPrice: string; paymentMethod: PaymentMethod }) => void;
}) {
  const [price, setPrice] = useState(a.service.price.replace(".", ","));
  const [payment, setPayment] = useState<PaymentMethod | null>(null);
  return (
    <form
      className="space-y-4 rounded-lg border border-primary/40 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (payment) onSubmit({ chargedPrice: price, paymentMethod: payment });
      }}
    >
      <h3 className="text-sm font-medium">Concluir e receber</h3>
      <Field id="cp-price" label="Valor cobrado (R$)" hint={`Tabela: ${formatBRL(a.service.price)}`} error={errors.chargedPrice}>
        <Input value={price} onChange={(e) => setPrice(e.target.value)} inputMode="decimal" autoFocus />
      </Field>
      <fieldset>
        <legend className="mb-2 text-sm font-medium">Pagamento</legend>
        <div className="grid grid-cols-3 gap-1.5">
          {(Object.entries(PAYMENT_METHODS) as [PaymentMethod, string][]).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={payment === k}
              onClick={() => setPayment(k)}
              className={cn("rounded-md border px-2 py-2 text-xs hover:bg-accent", payment === k && "border-primary bg-primary font-medium text-primary-foreground hover:bg-primary/90")}
            >
              {label}
            </button>
          ))}
        </div>
        {errors.paymentMethod && <p className="mt-1 text-xs text-destructive">{errors.paymentMethod}</p>}
      </fieldset>
      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" onClick={onCancel}>
          Voltar
        </Button>
        <Button type="submit" disabled={pending || !payment}>
          {pending && <Loader2 className="animate-spin" />} Confirmar conclusão
        </Button>
      </div>
    </form>
  );
}

"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CalendarPlus, CalendarClock, Copy, Loader2, MessageCircle, MoreHorizontal, Phone, XCircle } from "lucide-react";
import { toast } from "sonner";
import { formatPhone, whatsappUrl } from "@/lib/phone";
import { addDays, diffDaysISO, formatLocalDate, formatLocalDateTime, localParts } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { ProviderOption } from "@/server/services/catalog";
import type { FollowUpRow, FollowUpTab } from "@/server/services/followups";
import { closeFollowUpAction, registerContactAction, rescheduleFollowUpAction } from "@/server/actions/followups";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, NativeSelect, Textarea } from "@/components/ui/form-controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScheduleDialog, nextSlot, type ScheduleDraft, type ServiceOption } from "../agenda/schedule-dialog";

// Rótulos espelham CONTACT_CHANNELS / CONTACT_OUTCOMES do servidor.
const CHANNELS = { WHATSAPP: "WhatsApp", LIGACAO: "Ligação", OUTRO: "Outro" } as const;
const OUTCOMES = {
  SEM_RESPOSTA: "Não respondeu",
  FALAR_DEPOIS: "Pediu para falar depois",
  VAI_AGENDAR: "Vai agendar",
  NAO_QUER: "Não quer o retorno",
} as const;
type Outcome = keyof typeof OUTCOMES;
type Channel = keyof typeof CHANNELS;

const br = (iso: string) => iso.split("-").reverse().join("/");

/** "hoje", "em 3 dias", "há 5 dias" a partir de datas de calendário. */
function dueLabel(dueOn: string, today: string) {
  const d = diffDaysISO(today, dueOn);
  if (d === 0) return "hoje";
  if (d === 1) return "amanhã";
  if (d === -1) return "ontem";
  return d > 0 ? `em ${d} dias` : `há ${-d} dias`;
}

export function whatsappMessage(r: Pick<FollowUpRow, "customer" | "service" | "source">) {
  const first = r.customer.name.trim().split(/\s+/)[0];
  const last = r.source ? ` O último atendimento (${r.source.service}) foi em ${formatLocalDate(r.source.date)}.` : "";
  return `Olá, ${first}! Tudo bem? Passando para lembrar do seu retorno: ${r.service.name}.${last} Quer agendar um horário? Posso ver as datas disponíveis para você.`;
}

type Schedule = { services: ServiceOption[]; providers: ProviderOption[] } | null;
type Open = { kind: "contact" | "date" | "close"; row: FollowUpRow } | null;

export function FollowUpsTable({ rows, tab, now, manage, schedule }: { rows: FollowUpRow[]; tab: FollowUpTab; now: string; manage: boolean; schedule: Schedule }) {
  const today = localParts(new Date(now)).date;
  const [open, setOpen] = useState<Open>(null);
  const [scheduling, setScheduling] = useState<{ row: FollowUpRow; draft: ScheduleDraft } | null>(null);
  const router = useRouter();
  const pending = tab !== "agendados" && tab !== "historico";

  function startSchedule(row: FollowUpRow) {
    if (!schedule?.providers.length) return;
    const slot = row.dueOn > today ? { date: row.dueOn, time: "09:00" } : nextSlot();
    setScheduling({ row, draft: { ...slot, providerId: schedule.providers[0].id } });
  }

  const empty: Record<FollowUpTab, string> = {
    atrasados: "Nenhum retorno atrasado. Tudo em dia!",
    semana: "Nenhum retorno previsto para esta semana.",
    proximos: "Nenhum retorno previsto entre 7 e 30 dias.",
    depois: "Nenhum retorno previsto para mais adiante.",
    agendados: "Nenhum retorno com horário marcado.",
    historico: "Nada no histórico ainda.",
  };

  return (
    <>
      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Cliente</TableHead>
              <TableHead>Retorno</TableHead>
              <TableHead>{tab === "historico" ? "Situação" : "Previsto"}</TableHead>
              <TableHead>{tab === "agendados" ? "Horário marcado" : tab === "historico" ? "Quando" : "Último contato"}</TableHead>
              {pending && manage && <TableHead className="w-px text-right">Ações</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={5} className="h-28 text-center text-muted-foreground">
                  {empty[tab]}
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => {
              const late = r.status === "PENDENTE" && r.dueOn < today;
              return (
                <TableRow key={r.id}>
                  <TableCell className="whitespace-normal">
                    <Link href={`/clientes/${r.customer.id}`} className="font-medium underline-offset-4 hover:underline">
                      {r.customer.name}
                    </Link>
                    {r.customer.phone && <span className="block text-xs text-muted-foreground tabular-nums">{formatPhone(r.customer.phone)}</span>}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {r.service.name}
                    <span className="block text-xs text-muted-foreground">
                      {r.source ? `Após ${r.source.service} em ${formatLocalDate(r.source.date)}` : "Programado à mão"}
                    </span>
                  </TableCell>
                  <TableCell className="tabular-nums">
                    {tab === "historico" ? (
                      <>
                        <Badge variant="outline" className={r.status === "REALIZADO" ? "border-transparent bg-success/15 text-success" : ""}>
                          {r.status === "REALIZADO" ? "Realizado" : "Encerrado"}
                        </Badge>
                        {r.closedReason && <span className="mt-1 block max-w-64 text-xs whitespace-normal text-muted-foreground">{r.closedReason}</span>}
                      </>
                    ) : (
                      <>
                        {br(r.dueOn)}
                        <span className={cn("block text-xs text-muted-foreground", late && "font-medium text-destructive")}>{dueLabel(r.dueOn, today)}</span>
                      </>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {tab === "agendados" && r.appointment ? (
                      <span className="tabular-nums">{formatLocalDateTime(r.appointment.startsAt)}</span>
                    ) : tab === "historico" ? (
                      <span className="tabular-nums text-muted-foreground">{r.closedAt ? formatLocalDate(r.closedAt) : "—"}</span>
                    ) : r.lastContact ? (
                      <span className="text-sm">
                        {OUTCOMES[r.lastContact.outcome as Outcome] ?? r.lastContact.outcome}
                        <span className="block text-xs text-muted-foreground">
                          {CHANNELS[r.lastContact.channel as Channel] ?? r.lastContact.channel} · {formatLocalDate(r.lastContact.at)} · {r.lastContact.user}
                          {r.contacts > 1 && ` · ${r.contacts} contatos`}
                        </span>
                        {r.lastContact.note && <span className="block text-xs text-muted-foreground">“{r.lastContact.note}”</span>}
                      </span>
                    ) : (
                      <span className="text-sm text-muted-foreground">Ainda não procurado</span>
                    )}
                  </TableCell>
                  {pending && manage && (
                    <TableCell className="py-1.5">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button size="sm" onClick={() => setOpen({ kind: "contact", row: r })}>
                          <MessageCircle /> Contatar
                        </Button>
                        {schedule && (
                          <Button size="sm" variant="outline" onClick={() => startSchedule(r)}>
                            <CalendarPlus /> Agendar
                          </Button>
                        )}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button size="icon" variant="ghost" className="size-8" aria-label={`Mais ações do retorno de ${r.customer.name}`}>
                              <MoreHorizontal />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setOpen({ kind: "date", row: r })}>
                              <CalendarClock /> Mudar data
                            </DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" onSelect={() => setOpen({ kind: "close", row: r })}>
                              <XCircle /> Encerrar retorno
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <ContactDialog
        row={open?.kind === "contact" ? open.row : null}
        today={today}
        onClose={() => setOpen(null)}
        onSchedule={schedule ? (row) => startSchedule(row) : undefined}
      />
      <DateDialog row={open?.kind === "date" ? open.row : null} today={today} onClose={() => setOpen(null)} />
      <CloseDialog row={open?.kind === "close" ? open.row : null} onClose={() => setOpen(null)} />
      {schedule && (
        <ScheduleDialog
          draft={scheduling?.draft ?? null}
          onClose={() => {
            setScheduling(null);
            router.refresh();
          }}
          services={schedule.services}
          providers={schedule.providers}
          customers={[]}
          appointments={[]}
          presetCustomer={scheduling ? scheduling.row.customer : undefined}
          presetServiceId={scheduling?.row.service.id}
          followUpId={scheduling?.row.id}
        />
      )}
    </>
  );
}

function ContactDialog({ row, today, onClose, onSchedule }: { row: FollowUpRow | null; today: string; onClose: () => void; onSchedule?: (row: FollowUpRow) => void }) {
  return (
    <Dialog open={row !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">{row && <ContactForm key={row.id} row={row} today={today} onClose={onClose} onSchedule={onSchedule} />}</DialogContent>
    </Dialog>
  );
}

function ContactForm({ row, today, onClose, onSchedule }: { row: FollowUpRow; today: string; onClose: () => void; onSchedule?: (row: FollowUpRow) => void }) {
  const wa = whatsappUrl(row.customer.phone);
  const [message, setMessage] = useState(() => whatsappMessage(row));
  const [channel, setChannel] = useState<Channel>(wa ? "WHATSAPP" : "LIGACAO");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [snoozeTo, setSnoozeTo] = useState(addDays(today, 7));
  const [note, setNote] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!outcome) return;
    start(async () => {
      const res = await registerContactAction({ id: row.id, channel, outcome, note, snoozeTo: outcome === "FALAR_DEPOIS" ? snoozeTo : "" });
      if (!res.ok) {
        setErrors(res.fieldErrors ?? {});
        return void toast.error(res.error);
      }
      toast.success(
        outcome === "FALAR_DEPOIS" ? `Contato registrado. Retorno para ${br(snoozeTo)}` : outcome === "NAO_QUER" ? "Retorno encerrado" : "Contato registrado",
      );
      onClose();
      if (outcome === "VAI_AGENDAR" && onSchedule) onSchedule(row);
    });
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Contatar {row.customer.name}</DialogTitle>
        <DialogDescription>
          {row.service.name} · previsto para {br(row.dueOn)}
          {row.contacts > 0 && ` · ${row.contacts} contato(s) antes`}
        </DialogDescription>
      </DialogHeader>

      <Field id="fu-message" label="Mensagem" hint="Revise antes de enviar. O WhatsApp abre com o texto pronto.">
        <Textarea value={message} onChange={(e) => setMessage(e.target.value)} rows={4} maxLength={1000} />
      </Field>
      <div className="flex flex-wrap gap-2">
        {wa ? (
          <Button asChild variant="outline" size="sm" onClick={() => setChannel("WHATSAPP")}>
            <a href={`${wa}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer">
              <MessageCircle /> Abrir no WhatsApp
            </a>
          </Button>
        ) : (
          <p className="text-xs text-muted-foreground">{row.customer.phone ? "Telefone sem DDD de celular: o WhatsApp não abre direto." : "Cliente sem telefone cadastrado."}</p>
        )}
        {row.customer.phone && (
          <Button asChild variant="outline" size="sm" onClick={() => setChannel("LIGACAO")}>
            <a href={`tel:${row.customer.phone}`}>
              <Phone /> {formatPhone(row.customer.phone)}
            </a>
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(message);
              toast.success("Mensagem copiada");
            } catch {
              toast.error("Não foi possível copiar");
            }
          }}
        >
          <Copy /> Copiar mensagem
        </Button>
      </div>

      <fieldset>
        <legend className="mb-2 text-sm font-medium">Como foi o contato?</legend>
        <div className="grid grid-cols-2 gap-1.5">
          {(Object.entries(OUTCOMES) as [Outcome, string][]).map(([k, label]) => (
            <button
              key={k}
              type="button"
              aria-pressed={outcome === k}
              onClick={() => setOutcome(k)}
              className={cn("rounded-md border px-2 py-2 text-sm hover:bg-accent", outcome === k && "border-primary bg-primary font-medium text-primary-foreground hover:bg-primary/90")}
            >
              {label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="fu-channel" label="Por onde">
          <NativeSelect value={channel} onChange={(e) => setChannel(e.target.value as Channel)}>
            {(Object.entries(CHANNELS) as [Channel, string][]).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </NativeSelect>
        </Field>
        {outcome === "FALAR_DEPOIS" && (
          <Field id="fu-snooze" label="Falar de novo em" required error={errors.snoozeTo}>
            <Input type="date" value={snoozeTo} min={addDays(today, 1)} onChange={(e) => setSnoozeTo(e.target.value)} />
          </Field>
        )}
      </div>
      <Field id="fu-note" label={outcome === "NAO_QUER" ? "Motivo" : "Anotação"} hint={outcome === "NAO_QUER" ? "Ex.: trocou de aparelho, mudou de cidade" : undefined}>
        <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={outcome === "NAO_QUER" ? "" : "Opcional"} />
      </Field>

      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancelar
        </Button>
        <Button type="submit" disabled={!outcome || pending}>
          {pending && <Loader2 className="animate-spin" />}
          {outcome === "VAI_AGENDAR" && onSchedule ? "Registrar e agendar" : "Registrar contato"}
        </Button>
      </DialogFooter>
    </form>
  );
}

function DateDialog({ row, today, onClose }: { row: FollowUpRow | null; today: string; onClose: () => void }) {
  const [date, setDate] = useState("");
  const [pending, start] = useTransition();
  const value = date || row?.dueOn || today;

  function close() {
    setDate("");
    onClose();
  }

  return (
    <Dialog open={row !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-sm">
        {row && (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const res = await rescheduleFollowUpAction({ id: row.id, dueOn: value });
                if (!res.ok) return void toast.error(res.error);
                toast.success(`Retorno movido para ${br(value)}`);
                close();
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>Mudar data do retorno</DialogTitle>
              <DialogDescription>
                {row.service.name} · {row.customer.name}
              </DialogDescription>
            </DialogHeader>
            <Field id="fu-date" label="Nova data" required>
              <Input type="date" value={value} min={today} onChange={(e) => setDate(e.target.value)} />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Cancelar
              </Button>
              <Button type="submit" disabled={pending}>
                {pending && <Loader2 className="animate-spin" />} Salvar
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function CloseDialog({ row, onClose }: { row: FollowUpRow | null; onClose: () => void }) {
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  function close() {
    setReason("");
    onClose();
  }

  return (
    <Dialog open={row !== null} onOpenChange={(o) => !o && close()}>
      <DialogContent className="sm:max-w-md">
        {row && (
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                const res = await closeFollowUpAction({ id: row.id, reason });
                if (!res.ok) return void toast.error(res.error);
                toast.success("Retorno encerrado");
                close();
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>Encerrar retorno</DialogTitle>
              <DialogDescription>
                {row.service.name} · {row.customer.name}. Sai da lista de contatos e fica no histórico.
              </DialogDescription>
            </DialogHeader>
            <Field id="fu-reason" label="Motivo" required>
              <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={200} placeholder="Ex.: cliente vendeu o imóvel" />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close}>
                Cancelar
              </Button>
              <Button type="submit" variant="destructive" disabled={pending || reason.trim().length < 3}>
                {pending && <Loader2 className="animate-spin" />} Encerrar retorno
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

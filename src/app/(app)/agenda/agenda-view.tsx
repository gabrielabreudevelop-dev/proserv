"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { AGENDA_END_HOUR, AGENDA_START_HOUR, SLOT_MINUTES, addDays, localParts, longDate, minutesToTime, weekdayShort } from "@/lib/time";
import { cn } from "@/lib/utils";
import type { AppointmentRow } from "@/server/services/appointments";
import type { CustomerOption, ProviderOption } from "@/server/services/catalog";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/form-controls";
import { placeBlocks, snap } from "./layout-engine";
import { AppointmentSheet } from "./appointment-sheet";
import { ScheduleDialog, type ScheduleDraft, type ServiceOption } from "./schedule-dialog";

export type AgendaPerms = { seeAll: boolean; schedule: boolean; complete: boolean };

type Props = {
  view: "dia" | "semana";
  day: string;
  rangeStart: string;
  days: string[];
  today: string;
  appointments: AppointmentRow[];
  providers: ProviderOption[];
  providerFilter: string | null;
  services: ServiceOption[];
  customers: CustomerOption[];
  perms: AgendaPerms;
  currentUserId: string;
};

const HOUR_PX = 56;
const START = AGENDA_START_HOUR * 60;
const END = AGENDA_END_HOUR * 60;
const GRID_PX = ((END - START) / 60) * HOUR_PX;
const PROVIDER_TONES = ["var(--color-primary)", "oklch(0.55 0.15 280)", "oklch(0.6 0.14 40)", "oklch(0.55 0.12 150)", "oklch(0.55 0.16 330)"];

const STATUS_LABEL: Record<AppointmentRow["status"], string> = {
  AGENDADO: "Agendado",
  EM_ANDAMENTO: "Em andamento",
  CONCLUIDO: "Concluído",
  CANCELADO: "Cancelado",
};

function useNow() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    tick();
    const t = setInterval(tick, 60_000);
    return () => clearInterval(t);
  }, []);
  return now;
}

export function AgendaView(props: Props) {
  const { view, day, rangeStart, days, today, appointments, providers, providerFilter, services, customers, perms, currentUserId } = props;
  const router = useRouter();
  const now = useNow();
  const [showCancelled, setShowCancelled] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);

  const toneOf = useMemo(() => new Map(providers.map((p, i) => [p.id, PROVIDER_TONES[i % PROVIDER_TONES.length]])), [providers]);
  const visible = appointments.filter((a) => showCancelled || a.status !== "CANCELADO");
  const selectedAppt = appointments.find((a) => a.id === selected) ?? null;

  // Colunas: no dia, uma por prestador; na semana, uma por dia.
  const columns =
    view === "dia"
      ? (providerFilter ? providers.filter((p) => p.id === providerFilter) : providers).map((p) => ({ key: p.id, date: day, providerId: p.id as string | null, label: p.name, sub: null as string | null }))
      : days.map((d) => ({ key: d, date: d, providerId: providerFilter, label: weekdayShort(d), sub: d.slice(8) + "/" + d.slice(5, 7) }));

  const itemsFor = (col: (typeof columns)[number]) =>
    visible.filter((a) => {
      const p = localParts(new Date(a.startsAt));
      return p.date === col.date && (view === "semana" || a.provider.id === col.providerId);
    });

  const counts = {
    total: appointments.filter((a) => a.status !== "CANCELADO").length,
    done: appointments.filter((a) => a.status === "CONCLUIDO").length,
    cancelled: appointments.filter((a) => a.status === "CANCELADO").length,
  };

  const href = (patch: Record<string, string | null>) => {
    const q = new URLSearchParams({ dia: day, visao: view, ...(providerFilter && perms.seeAll ? { prestador: providerFilter } : {}) });
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) q.delete(k);
      else q.set(k, v);
    }
    return `/agenda?${q}`;
  };
  const step = view === "semana" ? 7 : 1;
  const title = view === "dia" ? longDate(day) : `Semana de ${rangeStart.slice(8)}/${rangeStart.slice(5, 7)} a ${addDays(rangeStart, 6).slice(8)}/${addDays(rangeStart, 6).slice(5, 7)}`;
  const nowMin = now ? localParts(now).minutes : null;
  const nowDate = now ? localParts(now).date : today;

  function clickSlot(col: (typeof columns)[number], e: React.MouseEvent<HTMLDivElement>) {
    if (!perms.schedule) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const minute = START + snap(((e.clientY - rect.top) / HOUR_PX) * 60, SLOT_MINUTES);
    setDraft({ date: col.date, time: minutesToTime(Math.min(minute, END - SLOT_MINUTES)), providerId: col.providerId ?? providers[0]?.id ?? "" });
  }

  return (
    <div className="space-y-4">
      {/* Barra */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1">
          <Button variant="outline" size="icon" className="size-9" asChild>
            <Link href={href({ dia: addDays(day, -step) })} aria-label={view === "dia" ? "Dia anterior" : "Semana anterior"}>
              <ChevronLeft />
            </Link>
          </Button>
          <Button variant="outline" size="icon" className="size-9" asChild>
            <Link href={href({ dia: addDays(day, step) })} aria-label={view === "dia" ? "Próximo dia" : "Próxima semana"}>
              <ChevronRight />
            </Link>
          </Button>
          <Button variant="outline" asChild disabled={day === today}>
            <Link href={href({ dia: today })}>Hoje</Link>
          </Button>
        </div>
        <h2 className="ml-2 text-base font-medium" aria-live="polite">
          {title}
        </h2>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground tabular-nums">
            {counts.total} atendimento(s) · {counts.done} concluído(s)
          </span>
          {counts.cancelled > 0 && (
            <label className="flex items-center gap-2 text-sm text-muted-foreground">
              <input type="checkbox" className="size-4 accent-primary" checked={showCancelled} onChange={(e) => setShowCancelled(e.target.checked)} />
              Cancelados ({counts.cancelled})
            </label>
          )}
          {perms.seeAll && (
            <NativeSelect
              aria-label="Filtrar por prestador"
              className="w-44"
              value={providerFilter ?? ""}
              onChange={(e) => router.push(href({ prestador: e.target.value || null }))}
            >
              <option value="">Todos os prestadores</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </NativeSelect>
          )}
          <div className="inline-flex rounded-lg border bg-muted p-0.5" role="tablist" aria-label="Visão">
            {(["dia", "semana"] as const).map((v) => (
              <Link
                key={v}
                role="tab"
                aria-selected={view === v}
                href={href({ visao: v })}
                className={cn("rounded-md px-3 py-1 text-sm text-muted-foreground", view === v && "bg-background font-medium text-foreground shadow-sm")}
              >
                {v === "dia" ? "Dia" : "Semana"}
              </Link>
            ))}
          </div>
          {perms.schedule && (
            <Button onClick={() => setDraft({ date: day < today ? today : day, time: "09:00", providerId: providerFilter ?? providers[0]?.id ?? "" })}>
              <Plus /> Agendar
            </Button>
          )}
        </div>
      </div>

      {/* Grade */}
      <div className="overflow-x-auto rounded-xl border">
        <div className="min-w-[720px]">
          <div className="grid border-b bg-muted/30" style={{ gridTemplateColumns: `64px repeat(${columns.length}, minmax(140px, 1fr))` }}>
            <div />
            {columns.map((c) => (
              <div key={c.key} className={cn("border-l px-3 py-2.5 text-sm", c.date === today && view === "semana" && "bg-accent/60")}>
                <span className="flex items-center gap-2 font-medium">
                  {view === "dia" && <span className="size-2 rounded-full" style={{ background: toneOf.get(c.key) }} aria-hidden />}
                  <span className={cn(view === "semana" && "capitalize")}>{c.label}</span>
                  {c.sub && <span className="font-normal text-muted-foreground tabular-nums">{c.sub}</span>}
                </span>
              </div>
            ))}
          </div>

          <div className="grid" style={{ gridTemplateColumns: `64px repeat(${columns.length}, minmax(140px, 1fr))` }}>
            {/* Horas */}
            <div className="relative" style={{ height: GRID_PX }}>
              {Array.from({ length: AGENDA_END_HOUR - AGENDA_START_HOUR }, (_, i) => (
                <span key={i} className="absolute right-2 -translate-y-1/2 text-xs text-muted-foreground tabular-nums" style={{ top: i * HOUR_PX }}>
                  {i === 0 ? "" : `${String(AGENDA_START_HOUR + i).padStart(2, "0")}:00`}
                </span>
              ))}
            </div>

            {columns.map((col) => {
              const items = itemsFor(col);
              const placed = placeBlocks(
                items.map((a) => {
                  const s = localParts(new Date(a.startsAt)).minutes;
                  return { id: a.id, start: s, end: s + Math.max(15, (new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60000) };
                }),
              );
              return (
                <div
                  key={col.key}
                  className={cn("relative border-l", perms.schedule && "cursor-copy", col.date === today && view === "semana" && "bg-accent/20")}
                  style={{
                    height: GRID_PX,
                    backgroundImage: `repeating-linear-gradient(to bottom, var(--color-border) 0 1px, transparent 1px ${HOUR_PX / 2}px)`,
                  }}
                  onClick={(e) => clickSlot(col, e)}
                  aria-label={`${col.label}${col.sub ? " " + col.sub : ""}`}
                >
                  {col.date === nowDate && nowMin !== null && nowMin >= START && nowMin <= END && (
                    <div className="pointer-events-none absolute inset-x-0 z-20 h-0.5 bg-destructive" style={{ top: ((nowMin - START) / 60) * HOUR_PX }} aria-hidden>
                      <span className="absolute -left-1 -top-[3px] size-2 rounded-full bg-destructive" />
                    </div>
                  )}
                  {items.map((a) => {
                    const p = placed.get(a.id)!;
                    const startMin = localParts(new Date(a.startsAt)).minutes;
                    const dur = (new Date(a.endsAt).getTime() - new Date(a.startsAt).getTime()) / 60000;
                    const top = ((Math.max(startMin, START) - START) / 60) * HOUR_PX;
                    const height = Math.max(22, (Math.min(dur, END - startMin) / 60) * HOUR_PX - 3);
                    const late = (a.status === "AGENDADO" || a.status === "EM_ANDAMENTO") && now !== null && new Date(a.endsAt) < now;
                    const tone = toneOf.get(a.provider.id) ?? PROVIDER_TONES[0];
                    const mine = a.provider.id === currentUserId;
                    return (
                      <button
                        key={a.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setSelected(a.id);
                        }}
                        className={cn(
                          "absolute z-10 overflow-hidden rounded-md border-l-[3px] px-2 py-1 text-left text-xs shadow-xs transition hover:z-30 hover:shadow-md focus-visible:z-30 focus-visible:outline-2 focus-visible:outline-ring",
                          a.status === "CONCLUIDO" && "opacity-70",
                          a.status === "CANCELADO" && "opacity-50 line-through",
                          late && "ring-1 ring-destructive",
                        )}
                        style={{
                          top,
                          height,
                          left: `calc(${(p.lane / p.lanes) * 100}% + 3px)`,
                          width: `calc(${100 / p.lanes}% - 6px)`,
                          borderLeftColor: tone,
                          background: `color-mix(in oklch, ${tone} ${a.status === "EM_ANDAMENTO" ? 26 : 14}%, var(--color-background))`,
                        }}
                        aria-label={`${minutesToTime(startMin)} ${a.customer.name}, ${a.service.name}, ${a.provider.name}, ${STATUS_LABEL[a.status]}${late ? ", atrasado" : ""}`}
                      >
                        <span className="flex items-center gap-1 font-medium tabular-nums">
                          {late && <AlertTriangle className="size-3 shrink-0 text-destructive" aria-hidden />}
                          {minutesToTime(startMin)}
                          {a.status === "CONCLUIDO" && <span aria-hidden>✓</span>}
                          {/* Bloco curto: cliente na mesma linha do horário */}
                          {height < 40 && <span className="truncate font-normal">{a.customer.name}</span>}
                          {height >= 40 && a.status === "EM_ANDAMENTO" && <span className="text-[10px] font-normal">em andamento</span>}
                        </span>
                        {height >= 40 && <span className="block truncate font-medium">{a.customer.name}</span>}
                        {height > 50 && <span className="block truncate text-muted-foreground">{a.service.name}</span>}
                        {height > 68 && view === "semana" && !providerFilter && (
                          <span className="block truncate text-muted-foreground">{mine ? "Você" : a.provider.name}</span>
                        )}
                      </button>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {view === "semana" && !providerFilter && providers.length > 1 && (
        <ul className="flex flex-wrap gap-4 text-xs text-muted-foreground" aria-label="Legenda de prestadores">
          {providers.map((p) => (
            <li key={p.id} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ background: toneOf.get(p.id) }} aria-hidden />
              {p.name}
            </li>
          ))}
        </ul>
      )}

      <AppointmentSheet
        appointment={selectedAppt}
        onClose={() => setSelected(null)}
        perms={perms}
        currentUserId={currentUserId}
        providers={providers}
        now={now}
      />
      {perms.schedule && (
        <ScheduleDialog draft={draft} onClose={() => setDraft(null)} services={services} providers={providers} customers={customers} appointments={appointments} />
      )}
    </div>
  );
}

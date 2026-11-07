import { cache } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, BellRing, CalendarClock, Mail, MessageCircle, Phone, ShieldOff } from "lucide-react";
import { requirePermission } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { formatBRL } from "@/lib/format";
import { formatPhone, whatsappUrl } from "@/lib/phone";
import { agoLabel, diffDaysISO, formatLocalDate, formatLocalDateTime, localParts } from "@/lib/time";
import { cn } from "@/lib/utils";
import { Kpi } from "@/components/month-picker";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { listProviders, listServices } from "@/server/services/catalog";
import { getCustomerDetail, listCustomerOptions } from "@/server/services/customers";
import { listFollowUps } from "@/server/services/followups";
import { CustomerActions, ProgramFollowUpButton } from "../customer-dialogs";

type Props = { params: Promise<{ id: string }> };

/** Uma consulta por requisição (título da aba + página). */
const load = cache((id: string) => getCustomerDetail(id));

export async function generateMetadata({ params }: Props) {
  const c = await load((await params).id);
  return { title: c ? c.name : "Cliente" };
}

const STATUS = {
  AGENDADO: { label: "Agendado", cls: "" },
  EM_ANDAMENTO: { label: "Em andamento", cls: "bg-warning/25 text-warning-foreground border-transparent" },
  CONCLUIDO: { label: "Concluído", cls: "bg-success/15 text-success border-transparent" },
  CANCELADO: { label: "Cancelado", cls: "bg-destructive/10 text-destructive border-transparent" },
} as const;

export default async function ClientePage({ params }: Props) {
  const { user } = await requirePermission("cliente", "ver");
  const { id } = await params;
  const now = new Date();
  const c = await load(id);
  if (!c) notFound();

  const manage = can(user.role, "cliente", "gerenciar") && !c.anonymized;
  const canSchedule = can(user.role, "agenda", "agendar") && !c.anonymized;
  const [services, providers, others, followUps] = await Promise.all([
    canSchedule || manage ? listServices({ includeCost: false }) : Promise.resolve([]),
    canSchedule ? listProviders() : Promise.resolve([]),
    manage ? listCustomerOptions() : Promise.resolve([]),
    listFollowUps({ customerId: c.id, now }),
  ]);
  const today = localParts(now).date;

  const s = c.stats;
  const upcoming = c.appointments.filter((a) => (a.status === "AGENDADO" || a.status === "EM_ANDAMENTO") && new Date(a.endsAt) >= now).reverse();
  const history = c.appointments.filter((a) => !upcoming.includes(a));
  const wa = whatsappUrl(c.phone);

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2 text-muted-foreground">
        <Link href="/clientes">
          <ArrowLeft /> Clientes
        </Link>
      </Button>

      <div className="mb-6 flex flex-col gap-4 lg:mb-8 lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">{c.name}</h1>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground">
            {c.phone && (
              <a href={`tel:${c.phone}`} className="inline-flex items-center gap-1.5 tabular-nums hover:text-foreground">
                <Phone className="size-3.5" aria-hidden /> {formatPhone(c.phone)}
              </a>
            )}
            {wa && (
              <a href={wa} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 hover:text-foreground">
                <MessageCircle className="size-3.5" aria-hidden /> WhatsApp
              </a>
            )}
            {c.email && (
              <a href={`mailto:${c.email}`} className="inline-flex items-center gap-1.5 hover:text-foreground">
                <Mail className="size-3.5" aria-hidden /> {c.email}
              </a>
            )}
            <span>Cliente desde {formatLocalDate(c.createdAt)}</span>
          </div>
        </div>
        {!c.anonymized && (
          <div className="flex flex-wrap items-center gap-2">
            <CustomerActions
              customer={{ id: c.id, name: c.name, phone: c.phone, email: c.email, notes: c.notes }}
              manage={manage}
              schedule={canSchedule ? { services: services.map((x) => ({ id: x.id, name: x.name, durationMin: x.durationMin, price: x.price })), providers, favoriteServiceId: c.stats.favoriteService?.id } : null}
              others={others.filter((o) => o.id !== c.id)}
            />
          </div>
        )}
      </div>

      {c.anonymized && (
        <p className="mb-6 flex items-start gap-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          <ShieldOff className="mt-0.5 size-4 shrink-0" aria-hidden />
          Os dados pessoais deste cliente foram apagados a pedido dele. O histórico abaixo fica só para a contabilidade.
        </p>
      )}

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Kpi label="Atendimentos concluídos" value={String(s.visits)} hint={s.cancelled ? `${s.cancelled} cancelado(s)` : "Nenhum cancelamento"} />
        <Kpi label="Gasto em serviços" value={formatBRL(s.servicesTotal)} hint={s.avgTicket ? `Ticket médio ${formatBRL(s.avgTicket)}` : undefined} />
        <Kpi label="Última visita" value={s.lastVisit ? formatLocalDate(s.lastVisit) : "—"} hint={s.lastVisit ? agoLabel(s.lastVisit, now) : "Ainda não foi atendido"} />
        <Kpi
          label="Frequência"
          value={s.avgIntervalDays === null ? "—" : s.avgIntervalDays === 0 ? "Mesmo dia" : `A cada ${s.avgIntervalDays} dia${s.avgIntervalDays > 1 ? "s" : ""}`}
          hint={s.avgIntervalDays === null ? "Precisa de duas visitas" : `Desde ${formatLocalDate(s.firstVisit!)}`}
        />
        <Kpi label="Serviço preferido" value={s.favoriteService?.name ?? "—"} hint={s.favoriteService ? `${s.favoriteService.count} vez(es)` : undefined} />
        <Kpi label="Compras de produtos" value={s.purchases ? formatBRL(s.productsTotal) : "—"} hint={s.purchases ? `${s.purchases} compra(s)` : "Nenhuma compra ligada"} />
      </div>

      <div className="mb-8 grid gap-4 lg:grid-cols-[1fr_20rem]">
        <section aria-labelledby="proximos" className="rounded-xl border">
          <h2 id="proximos" className="flex items-center gap-2 border-b px-5 py-3.5 text-sm font-medium">
            <CalendarClock className="size-4" aria-hidden /> Próximos horários
          </h2>
          {upcoming.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">Nada marcado.</p>
          ) : (
            <ul className="divide-y">
              {upcoming.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span>
                    <span className="font-medium tabular-nums">{formatLocalDateTime(a.startsAt)}</span> · {a.service} com {a.provider}
                  </span>
                  <Badge variant="outline" className={STATUS[a.status].cls}>
                    {STATUS[a.status].label}
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section aria-labelledby="obs" className="rounded-xl border">
          <h2 id="obs" className="border-b px-5 py-3.5 text-sm font-medium">
            Observações
          </h2>
          <p className={cn("px-5 py-4 text-sm whitespace-pre-line", !c.notes && "text-muted-foreground")}>{c.notes ?? "Sem observações."}</p>
        </section>
      </div>

      <section aria-labelledby="retornos" className="mb-8 rounded-xl border">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b px-5 py-2.5">
          <h2 id="retornos" className="flex items-center gap-2 text-sm font-medium">
            <BellRing className="size-4" aria-hidden /> Retornos previstos
          </h2>
          {manage && <ProgramFollowUpButton customerId={c.id} services={services.map((x) => ({ id: x.id, name: x.name }))} />}
        </div>
        {followUps.rows.length === 0 ? (
          <p className="px-5 py-6 text-sm text-muted-foreground">
            Nenhum retorno programado. Eles aparecem sozinhos quando um atendimento de serviço com retorno é concluído.
          </p>
        ) : (
          <ul className="divide-y">
            {followUps.rows.map((f) => {
              const days = diffDaysISO(today, f.dueOn);
              return (
                <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-sm">
                  <span>
                    <span className="font-medium">{f.service.name}</span>
                    {" · "}
                    {f.status === "AGENDADO" && f.appointment ? (
                      <>agendado para {formatLocalDateTime(f.appointment.startsAt)}</>
                    ) : (
                      <>
                        previsto para <span className="tabular-nums">{f.dueOn.split("-").reverse().join("/")}</span>
                        <span className={cn("text-muted-foreground", days < 0 && "font-medium text-destructive")}>
                          {" "}
                          ({days === 0 ? "hoje" : days > 0 ? `em ${days} dias` : `atrasado há ${-days} dias`})
                        </span>
                      </>
                    )}
                    {f.source && <span className="block text-xs text-muted-foreground">Após {f.source.service} em {formatLocalDate(f.source.date)}</span>}
                  </span>
                  {f.status === "PENDENTE" ? (
                    <Link href={`/retornos?q=${encodeURIComponent(c.name)}&aba=${days < 0 ? "atrasados" : days <= 6 ? "semana" : days <= 30 ? "proximos" : "depois"}`} className="text-xs font-medium text-primary hover:underline">
                      Contatar em Retornos
                    </Link>
                  ) : (
                    <Badge variant="outline">Agendado</Badge>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="historico" className="mb-8">
        <h2 id="historico" className="mb-3 text-lg font-semibold tracking-tight">
          Atendimentos <span className="text-sm font-normal text-muted-foreground">({history.length})</span>
        </h2>
        <div className="overflow-x-auto rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Data</TableHead>
                <TableHead>Serviço</TableHead>
                <TableHead>Prestador</TableHead>
                <TableHead>Situação</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                    Nenhum atendimento ainda.
                  </TableCell>
                </TableRow>
              )}
              {history.map((a) => (
                <TableRow key={a.id}>
                  <TableCell className="tabular-nums">{formatLocalDateTime(a.startsAt)}</TableCell>
                  <TableCell className="whitespace-normal">
                    {a.service}
                    {a.cancelReason && <span className="block text-xs text-muted-foreground">Motivo: {a.cancelReason}</span>}
                    {a.notes && <span className="block text-xs text-muted-foreground">{a.notes}</span>}
                  </TableCell>
                  <TableCell>{a.provider}</TableCell>
                  <TableCell>
                    <Badge variant="outline" className={STATUS[a.status].cls}>
                      {STATUS[a.status].label}
                    </Badge>
                  </TableCell>
                  <TableCell className={cn("text-right tabular-nums", a.status !== "CONCLUIDO" && "text-muted-foreground")}>
                    {a.status === "CONCLUIDO" && a.chargedPrice ? formatBRL(a.chargedPrice) : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section aria-labelledby="compras">
        <h2 id="compras" className="mb-3 text-lg font-semibold tracking-tight">
          Compras de produtos <span className="text-sm font-normal text-muted-foreground">({c.sales.length})</span>
        </h2>
        {c.sales.length === 0 ? (
          <p className="rounded-xl border border-dashed px-5 py-6 text-sm text-muted-foreground">
            Nenhuma compra ligada a este cliente. Para aparecer aqui, escolha o cliente no caixa ao registrar a venda.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Venda</TableHead>
                  <TableHead>Data</TableHead>
                  <TableHead>Itens</TableHead>
                  <TableHead className="text-right">Total</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {c.sales.map((v) => (
                  <TableRow key={v.id} className={cn(v.status === "CANCELADA" && "text-muted-foreground")}>
                    <TableCell className="tabular-nums">
                      nº {v.number}
                      {v.status === "CANCELADA" && (
                        <Badge variant="outline" className="ml-2 border-transparent bg-destructive/10 text-destructive">
                          Cancelada
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="tabular-nums">{formatLocalDateTime(v.createdAt)}</TableCell>
                    <TableCell className="whitespace-normal">{v.items}</TableCell>
                    <TableCell className={cn("text-right tabular-nums", v.status === "CANCELADA" && "line-through")}>{formatBRL(v.total)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
    </>
  );
}

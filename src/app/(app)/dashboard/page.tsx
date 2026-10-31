import Link from "next/link";
import { redirect } from "next/navigation";
import { AlertTriangle, ArrowRight, CalendarClock, Plus } from "lucide-react";
import { requireSession } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { formatBRL, formatPct, formatQty } from "@/lib/format";
import { localParts, longDate } from "@/lib/time";
import { cn } from "@/lib/utils";
import { DailyBarChart } from "@/components/bar-chart";
import { Kpi } from "@/components/month-picker";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { productsDashboard, servicesDashboard } from "@/server/services/dashboard";
import { SetDefaultFocus } from "./set-default-focus";

type Props = { searchParams: Promise<{ foco?: string }> };

const change = (c: number | null) => (c === null ? undefined : `${c >= 0 ? "▲" : "▼"} ${formatPct(Math.abs(c))} vs. 7 dias anteriores`);

export default async function DashboardPage({ searchParams }: Props) {
  const { user } = await requireSession();
  const { foco } = await searchParams;

  const seesProducts = can(user.role, "dashboardProdutos", "ver");
  const seesServices = can(user.role, "dashboardServicos", "ver");
  if (!seesProducts && !seesServices) redirect("/sem-acesso");

  const preferred = user.dashboardFocus === "SERVICOS" ? "servicos" : "produtos";
  let focus: "produtos" | "servicos" = foco === "servicos" || foco === "produtos" ? foco : preferred;
  if (focus === "produtos" && !seesProducts) focus = "servicos";
  if (focus === "servicos" && !seesServices) focus = "produtos";

  const firstName = user.name.split(" ")[0];
  const header = (description: string) => (
    <PageHeader
      title={`Olá, ${firstName}`}
      description={description}
      actions={seesProducts && seesServices ? <SetDefaultFocus focus={focus} isDefault={focus === preferred} /> : undefined}
    />
  );

  if (focus === "produtos") {
    const all = can(user.role, "dashboardProdutos", "verTodos");
    const profit = can(user.role, "financeiro", "ver");
    const d = await productsDashboard({ sellerId: all ? undefined : user.id, includeProfit: profit });
    const resultado = d.month ? Number(d.month.resultado) : null;
    return (
      <>
        {header(all ? `${longDate(d.today)} · vendas da loja nos últimos 7 dias` : `${longDate(d.today)} · suas vendas nos últimos 7 dias`)}
        <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Faturamento · 7 dias" value={formatBRL(d.revenue7)} hint={change(d.revenueChange)} />
          <Kpi label="Vendas · 7 dias" value={formatQty(d.count7)} hint={d.ticket7 !== null ? `Ticket médio ${formatBRL(d.ticket7)}` : "Sem vendas no período"} />
          <Kpi label="Estoque baixo" value={formatQty(d.lowStockCount)} hint={d.lowStockCount ? "produtos no mínimo ou zerados" : "Tudo abastecido"} tone={d.lowStockCount ? "negative" : undefined} />
          {resultado !== null ? (
            <Kpi label={resultado >= 0 ? "Lucro do mês" : "Prejuízo do mês"} value={formatBRL(Math.abs(resultado))} hint="Produtos + serviços − despesas" tone={resultado >= 0 ? "positive" : "negative"} />
          ) : (
            <div className="flex flex-col justify-between rounded-xl border p-5">
              <p className="text-sm text-muted-foreground">Atalho</p>
              <Button asChild className="mt-2">
                <Link href="/vendas/nova">
                  <Plus /> Nova venda
                </Link>
              </Button>
            </div>
          )}
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
          <section className="rounded-xl border p-5" aria-labelledby="chart-p">
            <div className="mb-3 flex items-baseline justify-between">
              <h2 id="chart-p" className="text-sm font-medium">Faturamento por dia</h2>
              <span className="text-xs text-muted-foreground">últimos 14 dias · destaque nos 7 mais recentes</span>
            </div>
            <DailyBarChart data={d.series} label="Faturamento de vendas por dia nos últimos 14 dias" today={d.today} />
          </section>

          <section className="rounded-xl border" aria-labelledby="top-p">
            <h2 id="top-p" className="border-b px-5 py-3.5 text-sm font-medium">Mais vendidos · 7 dias</h2>
            {d.top.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">Nenhuma venda no período.</p>
            ) : (
              <ol className="divide-y">
                {d.top.map((t, i) => (
                  <li key={t.sku} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <span className="w-4 text-muted-foreground tabular-nums">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{t.name}</span>
                    <span className="text-muted-foreground tabular-nums">{formatQty(t.qty)} un.</span>
                    <span className="w-20 text-right tabular-nums">{formatBRL(t.revenue)}</span>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </div>

        <section className="mt-6 rounded-xl border" aria-labelledby="low-p">
          <div className="flex items-center justify-between border-b px-5 py-3.5">
            <h2 id="low-p" className="flex items-center gap-2 text-sm font-medium">
              <AlertTriangle className="size-4 text-warning" aria-hidden /> Alertas de estoque
            </h2>
            <Link href="/produtos" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              Ver produtos <ArrowRight className="size-3.5" />
            </Link>
          </div>
          {d.lowStock.length === 0 ? (
            <p className="px-5 py-6 text-sm text-muted-foreground">Nenhum produto abaixo do mínimo.</p>
          ) : (
            <ul className="grid divide-y sm:grid-cols-2 sm:divide-y-0">
              {d.lowStock.map((p) => (
                <li key={p.id} className="flex items-center gap-3 border-b px-5 py-2.5 text-sm sm:odd:border-r">
                  <span className="w-16 font-mono text-xs text-muted-foreground">{p.sku}</span>
                  <span className="min-w-0 flex-1 truncate">{p.name}</span>
                  <span className={cn("tabular-nums", p.stockQty <= 0 ? "font-medium text-destructive" : "text-warning-foreground")}>
                    {p.stockQty <= 0 ? "Zerado" : `${formatQty(p.stockQty)} de mín. ${formatQty(p.minStock ?? 0)}`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </>
    );
  }

  // ── Serviços ───────────────────────────────────────────
  const all = can(user.role, "dashboardServicos", "verTodos");
  const money = can(user.role, "financeiro", "ver");
  const d = await servicesDashboard({ providerId: all ? undefined : user.id, includeMoney: money });
  const nowMin = localParts(new Date()).minutes;
  return (
    <>
      {header(all ? `${longDate(d.today)} · serviços e agenda da equipe` : `${longDate(d.today)} · seus serviços e agenda`)}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {d.money ? (
          <>
            <Kpi label="Faturamento hoje" value={formatBRL(d.money.today)} hint="Serviços concluídos" />
            <Kpi label="Faturamento · 7 dias" value={formatBRL(d.money.week)} hint={change(d.money.weekChange)} />
          </>
        ) : (
          <>
            <Kpi label="Concluídos hoje" value={`${d.counts.doneToday} de ${d.counts.today}`} />
            <Kpi label="A fazer hoje" value={formatQty(d.counts.pendingToday)} />
          </>
        )}
        <Kpi label="Atendimentos hoje" value={formatQty(d.counts.today)} hint={`${d.counts.doneToday} concluído(s) · ${d.counts.pendingToday} a fazer`} />
        <Kpi
          label="Taxa de conclusão · 7 dias"
          value={d.completionRate === null ? "—" : formatPct(d.completionRate)}
          hint={d.overdue.length ? `${d.overdue.length} atendimento(s) pendente(s)` : "Nenhum pendente"}
          tone={d.completionRate !== null && d.completionRate < 0.8 ? "negative" : undefined}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section className="rounded-xl border" aria-labelledby="today-s">
          <div className="flex items-center justify-between border-b px-5 py-3.5">
            <h2 id="today-s" className="flex items-center gap-2 text-sm font-medium">
              <CalendarClock className="size-4" aria-hidden /> Agenda de hoje
            </h2>
            <Link href="/agenda" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
              Abrir agenda <ArrowRight className="size-3.5" />
            </Link>
          </div>
          {d.agenda.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">Nenhum atendimento hoje.</p>
          ) : (
            <ol className="divide-y">
              {d.agenda.map((a) => {
                const s = localParts(new Date(a.startsAt));
                const e = localParts(new Date(a.endsAt));
                const isNext = d.nextUp?.id === a.id;
                const late = (a.status === "AGENDADO" || a.status === "EM_ANDAMENTO") && e.minutes < nowMin;
                return (
                  <li key={a.id} className={cn("flex items-center gap-4 px-5 py-3 text-sm", isNext && "bg-accent/60", a.status === "CONCLUIDO" && "text-muted-foreground")}>
                    <span className="w-24 shrink-0 tabular-nums">
                      {s.time}–{e.time}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{a.customer.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {a.service.name}
                        {all ? ` · ${a.provider.name}` : ""}
                      </span>
                    </span>
                    <span
                      className={cn(
                        "shrink-0 rounded px-2 py-0.5 text-xs",
                        a.status === "CONCLUIDO" && "bg-success/15 text-success",
                        a.status === "EM_ANDAMENTO" && "bg-warning/25 text-warning-foreground",
                        a.status === "AGENDADO" && (late ? "bg-destructive/10 text-destructive" : isNext ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"),
                      )}
                    >
                      {a.status === "CONCLUIDO" ? "Concluído" : a.status === "EM_ANDAMENTO" ? "Em andamento" : late ? "Atrasado" : isNext ? "Próximo" : "Agendado"}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        <section className="rounded-xl border" aria-labelledby="overdue-s">
          <h2 id="overdue-s" className="border-b px-5 py-3.5 text-sm font-medium">
            Pendentes <span className="text-muted-foreground">· horário passou e não foi concluído</span>
          </h2>
          {d.overdue.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">Nada pendente. 👍</p>
          ) : (
            <ul className="divide-y">
              {d.overdue.slice(0, 8).map((a) => {
                const s = localParts(new Date(a.startsAt));
                return (
                  <li key={a.id}>
                    <Link href={`/agenda?dia=${s.date}`} className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-muted/40">
                      <span className="w-24 shrink-0 tabular-nums text-destructive">
                        {s.date.slice(8)}/{s.date.slice(5, 7)} {s.time}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {a.customer.name} · {a.service.name}
                      </span>
                      {all && <span className="shrink-0 text-xs text-muted-foreground">{a.provider.name.split(" ")[0]}</span>}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {d.money && (
        <section className="mt-6 rounded-xl border p-5" aria-labelledby="chart-s">
          <div className="mb-3 flex items-baseline justify-between">
            <h2 id="chart-s" className="text-sm font-medium">Faturamento de serviços por dia</h2>
            <span className="text-xs text-muted-foreground">últimos 14 dias</span>
          </div>
          <DailyBarChart data={d.money.series} label="Faturamento de serviços por dia nos últimos 14 dias" today={d.today} width={1100} />
        </section>
      )}
    </>
  );
}

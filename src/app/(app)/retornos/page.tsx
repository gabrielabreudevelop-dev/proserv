import Link from "next/link";
import { Search } from "lucide-react";
import { requirePermission } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { formatBRL } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { Kpi } from "@/components/month-picker";
import { Input } from "@/components/ui/input";
import { listProviders, listServices } from "@/server/services/catalog";
import { followUpForecast, listFollowUps, type FollowUpTab } from "@/server/services/followups";
import { FollowUpsTable } from "./followups-table";

export const metadata = { title: "Retornos" };

const TABS: { key: FollowUpTab; label: string }[] = [
  { key: "atrasados", label: "Atrasados" },
  { key: "semana", label: "Esta semana" },
  { key: "proximos", label: "Próximos 30 dias" },
  { key: "depois", label: "Mais adiante" },
  { key: "agendados", label: "Agendados" },
  { key: "historico", label: "Histórico" },
];

type Props = { searchParams: Promise<{ aba?: string; q?: string }> };

export default async function RetornosPage({ searchParams }: Props) {
  const { user } = await requirePermission("cliente", "ver");
  const params = await searchParams;
  const q = (params.q ?? "").slice(0, 80);
  const now = new Date();
  const asked = TABS.find((t) => t.key === params.aba)?.key;

  let tab: FollowUpTab = asked ?? "atrasados";
  let data = await listFollowUps({ tab, q, now });
  // Sem aba escolhida e nada atrasado: abre direto na semana.
  if (!asked && data.counts.atrasados === 0) {
    tab = "semana";
    data = await listFollowUps({ tab, q, now });
  }

  const manage = can(user.role, "cliente", "gerenciar");
  const canSchedule = manage && can(user.role, "agenda", "agendar");
  const [forecast, services, providers] = await Promise.all([
    followUpForecast({ now }),
    canSchedule ? listServices({ includeCost: false }) : Promise.resolve([]),
    canSchedule ? listProviders() : Promise.resolve([]),
  ]);

  const href = (aba: FollowUpTab) => {
    const sp = new URLSearchParams({ aba });
    if (q) sp.set("q", q);
    return `/retornos?${sp}`;
  };

  return (
    <>
      <PageHeader title="Retornos" description="Clientes para procurar: manutenções e revisões previstas a partir dos atendimentos concluídos." />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Para contatar agora" value={String(forecast.overdue + forecast.week)} hint={`${forecast.overdue} atrasado(s) · ${forecast.week} nesta semana`} />
        <Kpi label="Previstos em 30 dias" value={String(forecast.total)} hint="Inclui os atrasados" />
        <Kpi label="Valor em potencial" value={formatBRL(forecast.value)} hint="Preço de tabela dos retornos em 30 dias" />
        <Kpi label="Já agendados" value={String(data.counts.agendados)} hint="Retornos com horário marcado" />
      </div>

      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <nav aria-label="Situação dos retornos" className="-mx-1 flex gap-1 overflow-x-auto px-1">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={href(t.key)}
              aria-current={tab === t.key ? "page" : undefined}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-md px-3 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
                tab === t.key && "bg-primary/10 font-medium text-foreground",
              )}
            >
              {t.label}
              <span
                className={cn(
                  "rounded-full bg-muted px-1.5 text-xs tabular-nums",
                  t.key === "atrasados" && data.counts.atrasados > 0 && "bg-destructive/10 text-destructive",
                )}
              >
                {data.counts[t.key]}
              </span>
            </Link>
          ))}
        </nav>
        <form action="/retornos" className="relative w-full lg:max-w-xs" role="search">
          <input type="hidden" name="aba" value={tab} />
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input name="q" defaultValue={q} placeholder="Cliente, telefone ou serviço" aria-label="Buscar retornos" className="pl-9" />
        </form>
      </div>

      <FollowUpsTable
        rows={data.rows}
        tab={tab}
        now={now.toISOString()}
        manage={manage}
        schedule={canSchedule ? { services: services.map((s) => ({ id: s.id, name: s.name, durationMin: s.durationMin, price: s.price })), providers } : null}
      />
    </>
  );
}

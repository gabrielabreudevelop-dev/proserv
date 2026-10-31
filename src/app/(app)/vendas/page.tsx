import Link from "next/link";
import { Plus } from "lucide-react";
import { requirePermission } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { monthRange } from "@/lib/finance-shared";
import { formatBRL, formatPct, formatQty } from "@/lib/format";
import { Kpi, MonthPicker, parseMonthParam } from "@/components/month-picker";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { listSales } from "@/server/services/sales";
import { SalesTable } from "./sales-table";

export const metadata = { title: "Vendas" };

type Props = { searchParams: Promise<{ mes?: string }> };

export default async function VendasPage({ searchParams }: Props) {
  const { user } = await requirePermission("venda", "registrar");
  const month = parseMonthParam((await searchParams).mes);
  const { from, to } = monthRange(month);

  const seeAll = can(user.role, "venda", "verTodas");
  const seeCost = can(user.role, "financeiro", "ver");
  const canCancel = can(user.role, "venda", "cancelar");

  // Vendedor vê só as próprias vendas — o filtro é aplicado na consulta, não na tela.
  const sales = await listSales({ from, to, sellerId: seeAll ? undefined : user.id, includeCost: seeCost });

  const done = sales.filter((s) => s.status === "CONCLUIDA");
  const revenue = done.reduce((t, s) => t + Number(s.total), 0);
  const cost = done.reduce((t, s) => t + Number(s.cost ?? 0), 0);
  const cancelled = sales.length - done.length;

  return (
    <>
      <PageHeader
        title={seeAll ? "Vendas" : "Minhas vendas"}
        description={seeAll ? "Todas as vendas do período" : "Vendas registradas por você no período"}
        actions={
          <>
            <MonthPicker month={month} basePath="/vendas" />
            <Button asChild>
              <Link href="/vendas/nova">
                <Plus /> Nova venda
              </Link>
            </Button>
          </>
        }
      />

      <div className={`mb-6 grid gap-4 sm:grid-cols-2 ${seeCost ? "lg:grid-cols-4" : "lg:grid-cols-3"}`}>
        <Kpi label="Vendas concluídas" value={formatQty(done.length)} hint={cancelled > 0 ? `${cancelled} cancelada(s)` : undefined} />
        <Kpi label="Faturamento" value={formatBRL(revenue)} hint="Já com descontos" />
        <Kpi label="Ticket médio" value={done.length ? formatBRL(revenue / done.length) : "—"} />
        {seeCost && (
          <Kpi
            label="Lucro bruto das vendas"
            value={formatBRL(revenue - cost)}
            hint={revenue > 0 ? `Margem ${formatPct((revenue - cost) / revenue)} · antes das despesas` : "Antes das despesas"}
            tone={revenue - cost < 0 ? "negative" : undefined}
          />
        )}
      </div>

      <SalesTable sales={sales} showSeller={seeAll} seeCost={seeCost} canCancel={canCancel} />
    </>
  );
}

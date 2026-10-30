import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { PageHeader, PlannedModule } from "@/components/page-header";

type Props = { searchParams: Promise<{ foco?: string }> };

export default async function DashboardPage({ searchParams }: Props) {
  const { user } = await requireSession();
  const { foco } = await searchParams;

  const seesProducts = can(user.role, "dashboardProdutos", "ver");
  const seesServices = can(user.role, "dashboardServicos", "ver");
  if (!seesProducts && !seesServices) redirect("/sem-acesso");

  // Prioridade: ?foco= da URL → preferência salva → primeira visão permitida.
  const preferred = user.dashboardFocus === "SERVICOS" ? "servicos" : "produtos";
  let focus = foco === "servicos" || foco === "produtos" ? foco : preferred;
  if (focus === "produtos" && !seesProducts) focus = "servicos";
  if (focus === "servicos" && !seesServices) focus = "produtos";

  const firstName = user.name.split(" ")[0];

  return (
    <>
      <PageHeader
        title={`Olá, ${firstName}`}
        description={focus === "produtos" ? "Visão de produtos e vendas da semana" : "Visão de serviços e agenda do dia"}
      />
      {focus === "produtos" ? (
        <PlannedModule
          phase="Fase 3"
          items={["Vendas da semana", "Ticket médio", "Top 5 produtos", "Alertas de estoque mínimo", "Lucro/Prejuízo do mês"]}
        />
      ) : (
        <PlannedModule
          phase="Fase 3"
          items={["Faturamento do dia", "Agenda do dia por prestador", "Serviços pendentes", "Taxa de conclusão"]}
        />
      )}
    </>
  );
}

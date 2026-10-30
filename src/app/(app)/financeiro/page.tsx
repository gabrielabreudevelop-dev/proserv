import { requirePermission } from "@/lib/auth/guards";
import { PageHeader, PlannedModule } from "@/components/page-header";

export default async function FinanceiroPage() {
  await requirePermission("financeiro", "ver");
  return (
    <>
      <PageHeader title="Financeiro" description="Lucro, prejuízo e lançamentos" />
      <PlannedModule
        phase="Fase 2"
        items={["DRE simplificada do período", "Lançamento de despesas", "Extrato do livro-razão", "Lucro/Prejuízo automático"]}
      />
    </>
  );
}

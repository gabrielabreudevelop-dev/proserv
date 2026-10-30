import { requirePermission } from "@/lib/auth/guards";
import { PageHeader, PlannedModule } from "@/components/page-header";

export default async function ServicosPage() {
  await requirePermission("servico", "ver");
  return (
    <>
      <PageHeader title="Serviços" description="Catálogo de serviços prestados" />
      <PlannedModule phase="Fase 3" items={["Cadastro com descrição, duração e valor", "Custo estimado (insumos/comissão)"]} />
    </>
  );
}

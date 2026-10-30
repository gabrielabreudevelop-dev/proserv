import { requirePermission } from "@/lib/auth/guards";
import { PageHeader, PlannedModule } from "@/components/page-header";

export default async function AgendaPage() {
  await requirePermission("agenda", "ver");
  return (
    <>
      <PageHeader title="Agenda" description="Atendimentos por dia e por prestador" />
      <PlannedModule
        phase="Fase 3"
        items={["Agenda dia e semana", "Agendamento vinculado a cliente", "Concluir atendimento com valor cobrado"]}
      />
    </>
  );
}

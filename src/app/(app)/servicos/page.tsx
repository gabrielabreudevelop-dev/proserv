import { requirePermission } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/page-header";
import { listServices } from "@/server/services/catalog";
import { ServicesManager } from "./services-manager";

export const metadata = { title: "Serviços" };

export default async function ServicosPage() {
  const { user } = await requirePermission("servico", "ver");
  const perms = { manage: can(user.role, "servico", "gerenciar"), seeCost: can(user.role, "financeiro", "ver") };
  const services = await listServices({ includeCost: perms.seeCost, includeInactive: perms.manage });
  return (
    <>
      <PageHeader title="Serviços" description="Tipos de serviço, duração e valor. A duração define o tamanho do horário na agenda." />
      <ServicesManager services={services} perms={perms} />
    </>
  );
}

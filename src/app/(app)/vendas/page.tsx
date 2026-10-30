import { requirePermission } from "@/lib/auth/guards";
import { PageHeader, PlannedModule } from "@/components/page-header";

export default async function VendasPage() {
  await requirePermission("venda", "registrar");
  return (
    <>
      <PageHeader title="Vendas" description="Ponto de venda e histórico" />
      <PlannedModule
        phase="Fase 2"
        items={["PDV com busca de produto", "Desconto e forma de pagamento", "Lista de vendas", "Cancelamento com estorno"]}
      />
    </>
  );
}

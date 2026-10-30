import { requirePermission } from "@/lib/auth/guards";
import { PageHeader, PlannedModule } from "@/components/page-header";

export default async function ProdutosPage() {
  await requirePermission("produto", "ver");
  return (
    <>
      <PageHeader title="Produtos" description="Catálogo, estoque e campos personalizados" />
      <PlannedModule
        phase="Fase 1"
        items={[
          "Cadastro e categorias",
          "Campos personalizados (ex.: Vencimento, Lote)",
          "Tabela com colunas ocultáveis",
          "Entradas de estoque com custo",
          "Custo médio ponderado",
          "Histórico de movimentos",
        ]}
      />
    </>
  );
}

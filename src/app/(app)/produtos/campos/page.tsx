import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth/guards";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { countFieldUsage, listFieldDefs } from "@/server/services/custom-fields";
import { FieldsManager } from "./fields-manager";

export const metadata = { title: "Campos personalizados" };

export default async function CamposPage() {
  await requirePermission("campo", "gerenciar");
  const [fields, usage] = await Promise.all([listFieldDefs({ includeArchived: true }), countFieldUsage()]);

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2 text-muted-foreground">
        <Link href="/produtos">
          <ArrowLeft /> Produtos
        </Link>
      </Button>
      <PageHeader
        title="Campos personalizados"
        description="Crie colunas como Vencimento, Lote ou Cor. Elas aparecem na tabela e no cadastro na hora, sem mexer no banco."
      />
      <FieldsManager fields={fields} usage={usage} />
    </>
  );
}

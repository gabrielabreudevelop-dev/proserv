import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requirePermission } from "@/lib/auth/guards";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { listSellableProducts } from "@/server/services/sales";
import { PointOfSale } from "./point-of-sale";

export const metadata = { title: "Nova venda" };

export default async function NovaVendaPage() {
  await requirePermission("venda", "registrar");
  const products = await listSellableProducts();
  return (
    <>
      <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2 text-muted-foreground">
        <Link href="/vendas">
          <ArrowLeft /> Vendas
        </Link>
      </Button>
      <PageHeader title="Nova venda" description="Busque pelo nome ou SKU e tecle Enter para adicionar." />
      <PointOfSale products={products} />
    </>
  );
}

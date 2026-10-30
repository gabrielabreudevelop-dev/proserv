import Link from "next/link";
import { SlidersHorizontal } from "lucide-react";
import { requirePermission } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { listFieldDefs } from "@/server/services/custom-fields";
import { listCategoryNames, listProducts } from "@/server/services/products";
import { getTablePref } from "@/server/services/table-prefs";
import { ProductsTable } from "./products-table";

export const metadata = { title: "Produtos" };

export default async function ProdutosPage() {
  const { user } = await requirePermission("produto", "ver");

  const perms = {
    seeCost: can(user.role, "financeiro", "ver"),
    create: can(user.role, "produto", "criar"),
    edit: can(user.role, "produto", "editar"),
    stock: can(user.role, "produto", "estoque"),
    manageFields: can(user.role, "campo", "gerenciar"),
  };

  const [products, fields, categories, pref] = await Promise.all([
    listProducts({ includeCost: perms.seeCost, includeInactive: perms.edit }),
    listFieldDefs(),
    listCategoryNames(),
    getTablePref(user.id, "products"),
  ]);

  return (
    <>
      <PageHeader
        title="Produtos"
        description="Catálogo, estoque e campos personalizados"
        actions={
          perms.manageFields && (
            <Button variant="outline" asChild>
              <Link href="/produtos/campos">
                <SlidersHorizontal /> Campos personalizados
              </Link>
            </Button>
          )
        }
      />
      <ProductsTable products={products} fields={fields} categories={categories} perms={perms} savedState={pref} />
    </>
  );
}

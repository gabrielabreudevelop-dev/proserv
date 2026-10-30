import {
  BadgeDollarSign,
  CalendarDays,
  LayoutDashboard,
  Package,
  ShoppingCart,
  Users,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { can, parseRoles, type Action, type Resource } from "@/lib/auth/permissions";

type Requirement = { [R in Resource]: { resource: R; action: Action<R> } }[Resource];

export type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Basta uma das permissões para o item aparecer. */
  anyOf?: Requirement[];
  adminOnly?: boolean;
};

export type NavSection = { title?: string; items: NavItem[] };

export const NAV: NavSection[] = [
  {
    items: [
      {
        href: "/dashboard",
        label: "Dashboard",
        icon: LayoutDashboard,
        anyOf: [
          { resource: "dashboardProdutos", action: "ver" },
          { resource: "dashboardServicos", action: "ver" },
        ],
      },
    ],
  },
  {
    title: "Operação",
    items: [
      { href: "/produtos", label: "Produtos", icon: Package, anyOf: [{ resource: "produto", action: "ver" }] },
      { href: "/vendas", label: "Vendas", icon: ShoppingCart, anyOf: [{ resource: "venda", action: "registrar" }] },
      { href: "/servicos", label: "Serviços", icon: Wrench, anyOf: [{ resource: "servico", action: "ver" }] },
      { href: "/agenda", label: "Agenda", icon: CalendarDays, anyOf: [{ resource: "agenda", action: "ver" }] },
    ],
  },
  {
    title: "Gestão",
    items: [
      { href: "/financeiro", label: "Financeiro", icon: BadgeDollarSign, anyOf: [{ resource: "financeiro", action: "ver" }] },
      { href: "/config/usuarios", label: "Usuários", icon: Users, adminOnly: true },
    ],
  },
];

export function isAdmin(role: string | null | undefined) {
  return parseRoles(role).includes("admin");
}

export function canSee(role: string | null | undefined, item: NavItem) {
  if (item.adminOnly) return isAdmin(role);
  if (!item.anyOf) return true;
  return item.anyOf.some((req) => can(role, req.resource, req.action as never));
}

/** Menu já filtrado pelo cargo — seções vazias somem. */
export function navFor(role: string | null | undefined): NavSection[] {
  return NAV.map((section) => ({
    ...section,
    items: section.items.filter((item) => canSee(role, item)),
  })).filter((section) => section.items.length > 0);
}

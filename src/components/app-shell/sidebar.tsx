"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import type { NavSection } from "@/lib/nav";
import { NAV } from "@/lib/nav";
import { SIDEBAR_COOKIE } from "@/lib/ui-prefs";
import { cn } from "@/lib/utils";

/**
 * Recebe apenas os hrefs permitidos (calculados no servidor) e reconstrói
 * os itens a partir do NAV — ícones não podem cruzar a fronteira servidor/cliente.
 * O estado recolhido vem de um cookie lido no servidor, então não há "pulo" ao carregar.
 */
export function Sidebar({
  allowedHrefs,
  initialCollapsed,
}: {
  allowedHrefs: string[];
  initialCollapsed: boolean;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  function toggle() {
    const next = !collapsed;
    setCollapsed(next);
    document.cookie = `${SIDEBAR_COOKIE}=${next ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  }

  const allowed = new Set(allowedHrefs);
  const sections: NavSection[] = NAV.map((s) => ({
    ...s,
    items: s.items.filter((i) => allowed.has(i.href)),
  })).filter((s) => s.items.length > 0);

  return (
    <aside
      className={cn(
        "sticky top-0 hidden h-dvh shrink-0 flex-col border-r bg-sidebar text-sidebar-foreground transition-[width] duration-200 md:flex",
        collapsed ? "w-16" : "w-60",
      )}
    >
      <div className={cn("flex h-14 items-center border-b px-4", collapsed && "justify-center px-0")}>
        <Link href="/dashboard" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid size-7 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
            PS
          </span>
          {!collapsed && <span>ProServ</span>}
        </Link>
      </div>

      <nav className="flex-1 space-y-5 overflow-y-auto px-2 py-4">
        {sections.map((section, i) => (
          <div key={section.title ?? i} className="space-y-1">
            {section.title && !collapsed && (
              <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                {section.title}
              </p>
            )}
            {section.items.map((item) => {
              const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  aria-current={active ? "page" : undefined}
                  className={cn(
                    "flex h-9 items-center gap-3 rounded-md px-3 text-sm transition-colors",
                    "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
                    active && "bg-sidebar-accent font-medium text-sidebar-accent-foreground",
                    collapsed && "justify-center px-0",
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <button
        type="button"
        onClick={toggle}
        className="flex h-11 items-center gap-3 border-t px-5 text-sm text-muted-foreground hover:text-foreground"
        aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
      >
        {collapsed ? <PanelLeftOpen className="size-4" /> : <PanelLeftClose className="size-4" />}
        {!collapsed && <span>Recolher</span>}
      </button>
    </aside>
  );
}

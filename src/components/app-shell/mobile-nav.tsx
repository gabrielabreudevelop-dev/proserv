"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { NAV } from "@/lib/nav";
import { cn } from "@/lib/utils";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";

/** Menu para telas pequenas (abaixo de 768 px), com os mesmos itens permitidos da barra lateral. */
export function MobileNav({ allowedHrefs }: { allowedHrefs: string[] }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const allowed = new Set(allowedHrefs);
  const sections = NAV.map((s) => ({ ...s, items: s.items.filter((i) => allowed.has(i.href)) })).filter((s) => s.items.length);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="grid size-9 place-items-center rounded-md border md:hidden"
        aria-label="Abrir menu"
        aria-expanded={open}
      >
        <Menu className="size-5" />
      </button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-72 max-w-[85vw] bg-sidebar">
          <SheetTitle className="flex h-14 items-center gap-2 border-b px-4 text-base">
            <span className="grid size-7 place-items-center rounded-md bg-primary text-xs font-bold text-primary-foreground">PS</span>
            ProServ
          </SheetTitle>
          <nav className="flex-1 space-y-5 overflow-y-auto px-2 py-4">
            {sections.map((section, i) => (
              <div key={section.title ?? i} className="space-y-1">
                {section.title && <p className="px-3 pb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">{section.title}</p>}
                {section.items.map((item) => {
                  const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={() => setOpen(false)}
                      aria-current={active ? "page" : undefined}
                      className={cn("flex h-11 items-center gap-3 rounded-md px-3 text-sm hover:bg-sidebar-accent", active && "bg-sidebar-accent font-medium")}
                    >
                      <Icon className="size-4" aria-hidden />
                      {item.label}
                    </Link>
                  );
                })}
              </div>
            ))}
          </nav>
        </SheetContent>
      </Sheet>
    </>
  );
}

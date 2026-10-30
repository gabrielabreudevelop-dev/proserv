"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Package, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

export type Focus = "produtos" | "servicos";

/**
 * Alterna o dashboard entre Produtos e Serviços.
 * Só é renderizado quando o cargo vê as duas visões.
 */
export function FocusSwitch({ defaultFocus }: { defaultFocus: Focus }) {
  const pathname = usePathname();
  const params = useSearchParams();
  if (pathname !== "/dashboard") return null;

  const current = (params.get("foco") as Focus | null) ?? defaultFocus;
  const options: { value: Focus; label: string; icon: typeof Package }[] = [
    { value: "produtos", label: "Produtos", icon: Package },
    { value: "servicos", label: "Serviços", icon: Wrench },
  ];

  return (
    <div role="tablist" aria-label="Foco do dashboard" className="inline-flex rounded-lg border bg-muted p-0.5">
      {options.map(({ value, label, icon: Icon }) => (
        <Link
          key={value}
          role="tab"
          aria-selected={current === value}
          href={`/dashboard?foco=${value}`}
          className={cn(
            "flex h-8 items-center gap-2 rounded-md px-3 text-sm text-muted-foreground transition-colors",
            current === value && "bg-background font-medium text-foreground shadow-sm",
          )}
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </Link>
      ))}
    </div>
  );
}

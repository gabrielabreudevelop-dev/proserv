"use client";

import { useTransition } from "react";
import { Pin } from "lucide-react";
import { toast } from "sonner";
import { setDashboardFocusAction } from "@/server/actions/services";
import { Button } from "@/components/ui/button";

/** Salva a visão atual (Produtos ou Serviços) como a que abre por padrão. */
export function SetDefaultFocus({ focus, isDefault }: { focus: "produtos" | "servicos"; isDefault: boolean }) {
  const [pending, start] = useTransition();
  if (isDefault) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
        <Pin className="size-3.5" aria-hidden /> Visão padrão
      </span>
    );
  }
  return (
    <Button
      variant="outline"
      size="sm"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await setDashboardFocusAction(focus);
          if (!res.ok) return void toast.error(res.error);
          toast.success(`A visão de ${focus === "produtos" ? "Produtos" : "Serviços"} abre por padrão`);
        })
      }
    >
      <Pin /> Definir como padrão
    </Button>
  );
}

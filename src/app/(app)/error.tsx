"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Erro inesperado numa página: mantém o menu e oferece tentar de novo. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="max-w-md text-center">
        <AlertTriangle className="mx-auto size-10 text-destructive" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold">Algo deu errado nesta página</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Nenhum dado foi perdido: operações com dinheiro e estoque só são gravadas por completo. Tente de novo; se continuar, avise o administrador
          {error.digest ? (
            <>
              {" "}
              informando o código <code className="rounded bg-muted px-1">{error.digest}</code>
            </>
          ) : null}
          .
        </p>
        <Button className="mt-6" onClick={reset}>
          <RotateCcw /> Tentar de novo
        </Button>
      </div>
    </div>
  );
}

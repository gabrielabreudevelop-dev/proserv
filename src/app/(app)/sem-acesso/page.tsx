import Link from "next/link";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function SemAcessoPage() {
  return (
    <div className="grid min-h-[60vh] place-items-center">
      <div className="max-w-sm text-center">
        <ShieldAlert className="mx-auto size-10 text-muted-foreground" aria-hidden />
        <h1 className="mt-4 text-xl font-semibold">Sem acesso a esta área</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Seu cargo não permite abrir esta página. Fale com o administrador se precisar de acesso.
        </p>
        <Button asChild className="mt-6">
          <Link href="/dashboard">Voltar ao início</Link>
        </Button>
      </div>
    </div>
  );
}

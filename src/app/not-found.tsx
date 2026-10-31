import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <div className="max-w-sm text-center">
        <p className="text-5xl font-semibold tracking-tight text-muted-foreground">404</p>
        <h1 className="mt-4 text-xl font-semibold">Página não encontrada</h1>
        <p className="mt-2 text-sm text-muted-foreground">O endereço pode ter mudado ou não existir mais.</p>
        <Button asChild className="mt-6">
          <Link href="/dashboard">Ir para o início</Link>
        </Button>
      </div>
    </main>
  );
}

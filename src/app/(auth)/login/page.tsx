import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/guards";
import { LoginForm } from "./login-form";

export const metadata = { title: "Entrar · ProServ" };

type Props = { searchParams: Promise<{ voltar?: string }> };

/** Só caminhos internos (evita redirecionamento aberto). */
const safe = (p?: string) => (p && p.startsWith("/") && !p.startsWith("//") ? p : "/dashboard");

export default async function LoginPage({ searchParams }: Props) {
  // Sessão válida e ativa → vai direto para o app. Cookie velho ou usuário bloqueado → mostra o login.
  const session = await getSession();
  if (session && !session.user.banned) redirect(safe((await searchParams).voltar));

  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_480px]">
      <section className="hidden flex-col justify-between bg-primary p-12 text-primary-foreground lg:flex">
        <div className="flex items-center gap-2 font-semibold">
          <span className="grid size-8 place-items-center rounded-md bg-primary-foreground text-sm font-bold text-primary">PS</span>
          ProServ
        </div>
        <div className="max-w-md space-y-3">
          <p className="text-3xl font-semibold leading-tight tracking-tight">Produtos, serviços e o resultado do mês no mesmo lugar.</p>
          <p className="text-primary-foreground/70">Cada venda e cada atendimento já entram no seu lucro.</p>
        </div>
        <p className="text-sm text-primary-foreground/60">© {new Date().getFullYear()} ProServ</p>
      </section>

      <section className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-sm space-y-6">
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">Entrar</h1>
            <p className="text-sm text-muted-foreground">Use o e-mail e a senha criados pelo administrador.</p>
          </div>
          <Suspense>
            <LoginForm />
          </Suspense>
        </div>
      </section>
    </div>
  );
}

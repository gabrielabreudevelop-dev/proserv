import { Suspense } from "react";
import { LoginForm } from "./login-form";

export const metadata = { title: "Entrar · ProServ" };

export default function LoginPage() {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_480px]">
      <section className="hidden flex-col justify-between bg-primary p-12 text-primary-foreground lg:flex">
        <div className="flex items-center gap-2 font-semibold">
          <span className="grid size-8 place-items-center rounded-md bg-primary-foreground text-sm font-bold text-primary">
            PS
          </span>
          ProServ
        </div>
        <div className="max-w-md space-y-3">
          <p className="text-3xl font-semibold leading-tight tracking-tight">
            Produtos, serviços e o resultado do mês no mesmo lugar.
          </p>
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

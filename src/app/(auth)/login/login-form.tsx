"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { authClient } from "@/lib/auth/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const ERRORS: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD: "E-mail ou senha incorretos.",
  BANNED_USER: "Seu acesso está bloqueado. Fale com o administrador.",
};

/** Só aceita caminhos internos para evitar redirecionamento aberto. */
function safeRedirect(path: string | null) {
  return path && path.startsWith("/") && !path.startsWith("//") ? path : "/dashboard";
}

export function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(
    params.get("erro") === "bloqueado" ? ERRORS.BANNED_USER : null,
  );
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);

    const { error } = await authClient.signIn.email({
      email: String(form.get("email")),
      password: String(form.get("password")),
    });

    if (error) {
      const message =
        error.status === 429
          ? "Muitas tentativas seguidas. Aguarde alguns segundos e tente de novo."
          : (ERRORS[error.code ?? ""] ?? "Não foi possível entrar. Tente novamente.");
      setError(message);
      setPending(false);
      return;
    }

    router.push(safeRedirect(params.get("voltar")));
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="email">E-mail</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Senha</Label>
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </div>
      {error && (
        <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        Entrar
      </Button>
    </form>
  );
}

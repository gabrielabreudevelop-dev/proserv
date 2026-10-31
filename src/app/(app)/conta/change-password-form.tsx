"use client";

import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/form-controls";

export function ChangePasswordForm() {
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form);
        const current = String(fd.get("current") ?? "");
        const next = String(fd.get("next") ?? "");
        const confirm = String(fd.get("confirm") ?? "");
        const errs: Record<string, string> = {};
        if (!current) errs.current = "Informe a senha atual";
        if (next.length < 8) errs.next = "Mínimo de 8 caracteres";
        else if (next === current) errs.next = "Use uma senha diferente da atual";
        if (confirm !== next) errs.confirm = "As senhas não conferem";
        setErrors(errs);
        if (Object.keys(errs).length) return;
        start(async () => {
          const { error } = await authClient.changePassword({ currentPassword: current, newPassword: next, revokeOtherSessions: true });
          if (error) {
            const wrong = error.code === "INVALID_PASSWORD";
            setErrors(wrong ? { current: "Senha atual incorreta" } : {});
            return void toast.error(wrong ? "Senha atual incorreta." : "Não foi possível trocar a senha.");
          }
          form.reset();
          toast.success("Senha trocada. Outros dispositivos foram desconectados.");
        });
      }}
    >
      <Field id="pw-current" label="Senha atual" required error={errors.current}>
        <Input name="current" type="password" autoComplete="current-password" />
      </Field>
      <Field id="pw-next" label="Nova senha" required hint="Mínimo de 8 caracteres" error={errors.next}>
        <Input name="next" type="password" autoComplete="new-password" />
      </Field>
      <Field id="pw-confirm" label="Repita a nova senha" required error={errors.confirm}>
        <Input name="confirm" type="password" autoComplete="new-password" />
      </Field>
      <Button type="submit" disabled={pending}>
        {pending && <Loader2 className="animate-spin" />} Trocar senha
      </Button>
    </form>
  );
}

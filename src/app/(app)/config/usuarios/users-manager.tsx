"use client";

import { useState, useTransition } from "react";
import { Copy, KeyRound, Loader2, MoreHorizontal, Plus, ShieldCheck, UserCheck, UserX } from "lucide-react";
import { toast } from "sonner";
import { ROLE_LABELS, ROLE_NAMES, type RoleName } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import type { UserRow } from "@/server/services/users";
import { createUserAction, resetPasswordAction, setBlockedAction, setRolesAction } from "@/server/actions/users";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox, Field } from "@/components/ui/form-controls";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const ROLE_HINT: Record<RoleName, string> = {
  admin: "Tudo, inclusive usuários e auditoria",
  gerente: "Opera todo o negócio e vê o financeiro",
  vendedor: "Produtos (consulta), PDV e as próprias vendas",
  prestador: "Catálogo de serviços e a própria agenda",
};

const rel = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
function lastSeen(iso: string | null) {
  if (!iso) return "Nunca entrou";
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
  return days === 0 ? "Hoje" : rel.format(days, "day");
}

type Dialogs =
  | { kind: "create" }
  | { kind: "roles"; user: UserRow }
  | { kind: "block"; user: UserRow }
  | { kind: "password"; name: string; email: string; password: string; isNew: boolean }
  | null;

export function UsersManager({ users, currentUserId }: { users: UserRow[]; currentUserId: string }) {
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [pending, start] = useTransition();

  function unblock(u: UserRow) {
    start(async () => {
      const res = await setBlockedAction({ userId: u.id, blocked: false });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`${u.name} pode entrar de novo`);
    });
  }
  function reset(u: UserRow) {
    start(async () => {
      const res = await resetPasswordAction(u.id);
      if (!res.ok) return void toast.error(res.error);
      setDialog({ kind: "password", name: u.name, email: u.email, password: res.data.password, isNew: false });
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setDialog({ kind: "create" })}>
          <Plus /> Novo usuário
        </Button>
      </div>
      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Nome</TableHead>
              <TableHead>E-mail</TableHead>
              <TableHead>Cargo</TableHead>
              <TableHead>Último acesso</TableHead>
              <TableHead className="w-12">
                <span className="sr-only">Ações</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((u) => {
              const me = u.id === currentUserId;
              return (
                <TableRow key={u.id} className={cn(u.banned && "text-muted-foreground")}>
                  <TableCell className="font-medium">
                    {u.name}
                    {me && <span className="ml-2 text-xs font-normal text-muted-foreground">(você)</span>}
                    {u.banned && (
                      <Badge variant="outline" className="ml-2 border-destructive/40 text-destructive" title={u.banReason ?? undefined}>
                        Bloqueado
                      </Badge>
                    )}
                  </TableCell>
                  <TableCell>{u.email}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {u.roles.map((r) => (
                        <Badge key={r} variant={r === "admin" ? "default" : "secondary"}>
                          {ROLE_LABELS[r]}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{lastSeen(u.lastSeen)}</TableCell>
                  <TableCell className="py-1">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon" className="size-8" aria-label={`Ações de ${u.name}`} disabled={pending}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem onSelect={() => setDialog({ kind: "roles", user: u })}>
                          <ShieldCheck /> Alterar cargo
                        </DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => reset(u)} disabled={u.banned}>
                          <KeyRound /> Gerar senha provisória
                        </DropdownMenuItem>
                        {!me && (
                          <>
                            <DropdownMenuSeparator />
                            {u.banned ? (
                              <DropdownMenuItem onSelect={() => unblock(u)}>
                                <UserCheck /> Desbloquear acesso
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem variant="destructive" onSelect={() => setDialog({ kind: "block", user: u })}>
                                <UserX /> Bloquear acesso
                              </DropdownMenuItem>
                            )}
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>
      <p className="text-xs text-muted-foreground">
        Não há cadastro público: só o administrador cria contas. Para desligar alguém, bloqueie o acesso — o histórico continua preservado.
      </p>

      <Dialog open={dialog !== null} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          {dialog?.kind === "create" && <CreateForm onDone={(r) => setDialog(r ? { kind: "password", ...r, isNew: true } : null)} />}
          {dialog?.kind === "roles" && <RolesForm user={dialog.user} isMe={dialog.user.id === currentUserId} onDone={() => setDialog(null)} />}
          {dialog?.kind === "block" && <BlockForm user={dialog.user} onDone={() => setDialog(null)} />}
          {dialog?.kind === "password" && <PasswordShown {...dialog} onDone={() => setDialog(null)} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RoleChecks({ value, onChange, disabledRoles = [], error }: { value: RoleName[]; onChange: (r: RoleName[]) => void; disabledRoles?: RoleName[]; error?: string }) {
  return (
    <fieldset className="space-y-2">
      <legend className="mb-1 text-sm font-medium">Cargo</legend>
      {ROLE_NAMES.map((r) => (
        <label key={r} className={cn("flex items-start gap-3 rounded-md border p-3 text-sm", value.includes(r) && "border-primary/50 bg-primary/5")}>
          <Checkbox
            className="mt-0.5"
            checked={value.includes(r)}
            disabled={disabledRoles.includes(r)}
            onChange={(e) => onChange(e.target.checked ? [...value, r] : value.filter((x) => x !== r))}
          />
          <span>
            <span className="font-medium">{ROLE_LABELS[r]}</span>
            <span className="block text-xs text-muted-foreground">{ROLE_HINT[r]}</span>
          </span>
        </label>
      ))}
      {error && <p className="text-xs text-destructive">{error}</p>}
      <p className="text-xs text-muted-foreground">Dá para combinar cargos — por exemplo, vendedor e prestador.</p>
    </fieldset>
  );
}

function CreateForm({ onDone }: { onDone: (r: { name: string; email: string; password: string } | null) => void }) {
  const [roles, setRoles] = useState<RoleName[]>(["vendedor"]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        const name = String(fd.get("name") ?? "");
        const email = String(fd.get("email") ?? "");
        start(async () => {
          const res = await createUserAction({ name, email, roles });
          if (!res.ok) {
            setErrors(res.fieldErrors ?? {});
            return void toast.error(res.error);
          }
          onDone({ name, email: email.trim().toLowerCase(), password: res.data.password });
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>Novo usuário</DialogTitle>
        <DialogDescription>Uma senha provisória é gerada na hora para você repassar.</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-4">
        <Field id="nu-name" label="Nome" required error={errors.name}>
          <Input name="name" maxLength={80} autoFocus />
        </Field>
        <Field id="nu-email" label="E-mail" required error={errors.email}>
          <Input name="email" type="email" autoComplete="off" />
        </Field>
      </div>
      <RoleChecks value={roles} onChange={setRoles} error={errors.roles} />
      <DialogFooter>
        <Button type="button" variant="outline" onClick={() => onDone(null)}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending || roles.length === 0}>
          {pending && <Loader2 className="animate-spin" />} Criar usuário
        </Button>
      </DialogFooter>
    </form>
  );
}

function RolesForm({ user, isMe, onDone }: { user: UserRow; isMe: boolean; onDone: () => void }) {
  const [roles, setRoles] = useState<RoleName[]>(user.roles);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await setRolesAction({ userId: user.id, roles });
          if (!res.ok) return void toast.error(res.error);
          toast.success(`Cargo de ${user.name} atualizado. Vale no próximo carregamento de página.`);
          onDone();
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>Cargo de {user.name}</DialogTitle>
        <DialogDescription>{user.email}</DialogDescription>
      </DialogHeader>
      <RoleChecks value={roles} onChange={setRoles} disabledRoles={isMe ? ["admin"] : []} />
      {isMe && <p className="text-xs text-muted-foreground">Você não pode remover o seu próprio cargo de administrador.</p>}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancelar
        </Button>
        <Button type="submit" disabled={pending || roles.length === 0}>
          {pending && <Loader2 className="animate-spin" />} Salvar
        </Button>
      </DialogFooter>
    </form>
  );
}

function BlockForm({ user, onDone }: { user: UserRow; onDone: () => void }) {
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        const reason = String(new FormData(e.currentTarget).get("reason") ?? "");
        start(async () => {
          const res = await setBlockedAction({ userId: user.id, blocked: true, reason });
          if (!res.ok) return void toast.error(res.error);
          toast.success(`Acesso de ${user.name} bloqueado e sessões encerradas`);
          onDone();
        });
      }}
    >
      <DialogHeader>
        <DialogTitle>Bloquear {user.name}?</DialogTitle>
        <DialogDescription>A pessoa sai na hora de todos os dispositivos e não consegue entrar. Vendas, atendimentos e o histórico continuam no sistema.</DialogDescription>
      </DialogHeader>
      <Field id="bl-reason" label="Motivo (opcional)">
        <Input name="reason" maxLength={200} placeholder="Ex.: desligado em 30/10" />
      </Field>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Voltar
        </Button>
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />} Bloquear acesso
        </Button>
      </DialogFooter>
    </form>
  );
}

function PasswordShown({ name, email, password, isNew, onDone }: { name: string; email: string; password: string; isNew: boolean; onDone: () => void }) {
  const text = `Acesso ao ProServ\nE-mail: ${email}\nSenha provisória: ${password}\nTroque a senha em "Minha conta" depois de entrar.`;
  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>{isNew ? `${name} foi cadastrado(a)` : `Nova senha de ${name}`}</DialogTitle>
        <DialogDescription>Esta senha aparece só agora. Copie e repasse por um canal seguro.</DialogDescription>
      </DialogHeader>
      <div className="rounded-lg border bg-muted/40 p-4">
        <p className="text-xs text-muted-foreground">Senha provisória</p>
        <p className="mt-1 select-all font-mono text-xl tracking-wide" data-testid="temp-password">
          {password}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">{email}</p>
      </div>
      <DialogFooter>
        <Button
          variant="outline"
          onClick={() =>
            navigator.clipboard.writeText(text).then(
              () => toast.success("Copiado"),
              () => toast.error("Não foi possível copiar; selecione a senha manualmente"),
            )
          }
        >
          <Copy /> Copiar acesso
        </Button>
        <Button onClick={onDone}>Pronto</Button>
      </DialogFooter>
    </div>
  );
}

import { requireSession } from "@/lib/auth/guards";
import { parseRoles, ROLE_LABELS } from "@/lib/auth/permissions";
import { PageHeader } from "@/components/page-header";
import { ChangePasswordForm } from "./change-password-form";

export const metadata = { title: "Minha conta" };

export default async function ContaPage() {
  const { user } = await requireSession();
  return (
    <>
      <PageHeader title="Minha conta" />
      <div className="grid max-w-3xl gap-6 lg:grid-cols-2">
        <section className="rounded-xl border p-5">
          <h2 className="mb-4 text-sm font-medium">Seus dados</h2>
          <dl className="grid grid-cols-[6rem_1fr] gap-y-2 text-sm">
            <dt className="text-muted-foreground">Nome</dt>
            <dd>{user.name}</dd>
            <dt className="text-muted-foreground">E-mail</dt>
            <dd>{user.email}</dd>
            <dt className="text-muted-foreground">Cargo</dt>
            <dd>{parseRoles(user.role).map((r) => ROLE_LABELS[r]).join(", ")}</dd>
          </dl>
          <p className="mt-4 text-xs text-muted-foreground">Para mudar nome, e-mail ou cargo, fale com o administrador.</p>
        </section>
        <section className="rounded-xl border p-5">
          <h2 className="mb-4 text-sm font-medium">Trocar senha</h2>
          <ChangePasswordForm />
        </section>
      </div>
    </>
  );
}

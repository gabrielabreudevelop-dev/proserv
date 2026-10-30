import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/guards";
import { parseRoles, ROLE_LABELS } from "@/lib/auth/permissions";
import { isAdmin } from "@/lib/nav";
import { prisma } from "@/lib/db";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";

export default async function UsuariosPage() {
  const { user } = await requireSession();
  if (!isAdmin(user.role)) redirect("/sem-acesso");

  const users = await prisma.user.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, email: true, role: true, banned: true, createdAt: true },
  });

  return (
    <>
      <PageHeader title="Usuários" description={`${users.length} pessoas com acesso ao sistema`} />
      <div className="overflow-hidden rounded-xl border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Nome</th>
              <th className="px-4 py-3 font-medium">E-mail</th>
              <th className="px-4 py-3 font-medium">Cargo</th>
              <th className="px-4 py-3 font-medium">Situação</th>
              <th className="px-4 py-3 text-right font-medium">Desde</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-muted/30">
                <td className="px-4 py-3 font-medium">{u.name}</td>
                <td className="px-4 py-3 text-muted-foreground">{u.email}</td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    {parseRoles(u.role).map((r) => (
                      <Badge key={r} variant={r === "admin" ? "default" : "secondary"}>
                        {ROLE_LABELS[r]}
                      </Badge>
                    ))}
                  </div>
                </td>
                <td className="px-4 py-3">{u.banned ? "Bloqueado" : "Ativo"}</td>
                <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                  {u.createdAt.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

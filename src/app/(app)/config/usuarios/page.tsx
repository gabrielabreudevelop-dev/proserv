import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth/guards";
import { isAdmin } from "@/lib/nav";
import { PageHeader } from "@/components/page-header";
import { listUsers } from "@/server/services/users";
import { UsersManager } from "./users-manager";

export const metadata = { title: "Usuários" };

export default async function UsuariosPage() {
  const { user } = await requireSession();
  if (!isAdmin(user.role)) redirect("/sem-acesso");
  const users = await listUsers();
  const active = users.filter((u) => !u.banned).length;
  return (
    <>
      <PageHeader title="Usuários" description={`${active} pessoa(s) com acesso · cada um vê só o que o cargo permite`} />
      <UsersManager users={users} currentUserId={user.id} />
    </>
  );
}

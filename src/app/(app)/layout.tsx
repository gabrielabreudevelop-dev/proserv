import { Suspense } from "react";
import { cookies } from "next/headers";
import { requireSession } from "@/lib/auth/guards";
import { SIDEBAR_COOKIE } from "@/lib/ui-prefs";
import { can, parseRoles, ROLE_LABELS } from "@/lib/auth/permissions";
import { navFor } from "@/lib/nav";
import { Sidebar } from "@/components/app-shell/sidebar";
import { UserMenu } from "@/components/app-shell/user-menu";
import { FocusSwitch, type Focus } from "@/components/app-shell/focus-switch";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireSession();
  const sidebarCollapsed = (await cookies()).get(SIDEBAR_COOKIE)?.value === "1";

  const allowedHrefs = navFor(user.role).flatMap((s) => s.items.map((i) => i.href));
  const roleLabel = parseRoles(user.role).map((r) => ROLE_LABELS[r]).join(", ") || "Sem cargo";

  const seesProducts = can(user.role, "dashboardProdutos", "ver");
  const seesServices = can(user.role, "dashboardServicos", "ver");
  const defaultFocus: Focus =
    user.dashboardFocus === "SERVICOS" || !seesProducts ? "servicos" : "produtos";

  return (
    <div className="flex min-h-dvh bg-background">
      <Sidebar allowedHrefs={allowedHrefs} initialCollapsed={sidebarCollapsed} />

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between gap-4 border-b bg-background/95 px-4 backdrop-blur lg:px-8">
          <div>
            {seesProducts && seesServices && (
              <Suspense>
                <FocusSwitch defaultFocus={defaultFocus} />
              </Suspense>
            )}
          </div>
          <UserMenu name={user.name} email={user.email} roleLabel={roleLabel} />
        </header>

        <main className="mx-auto w-full max-w-[1440px] flex-1 px-4 py-6 lg:px-8 lg:py-8">{children}</main>
      </div>
    </div>
  );
}

import { requirePermission } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { addDays, isISODate, localParts, localRange, weekStart } from "@/lib/time";
import { PageHeader } from "@/components/page-header";
import { listAppointments } from "@/server/services/appointments";
import { listCustomers, listProviders, listServices } from "@/server/services/catalog";
import { AgendaView } from "./agenda-view";

export const metadata = { title: "Agenda" };

type Props = { searchParams: Promise<{ dia?: string; visao?: string; prestador?: string }> };

export default async function AgendaPage({ searchParams }: Props) {
  const { user } = await requirePermission("agenda", "ver");
  const params = await searchParams;

  const perms = {
    seeAll: can(user.role, "agenda", "verTodas"),
    schedule: can(user.role, "agenda", "agendar"),
    complete: can(user.role, "agenda", "concluir"),
  };
  const today = localParts(new Date()).date;
  const day = isISODate(params.dia) ? params.dia : today;
  const view = params.visao === "semana" ? "semana" : "dia";

  // Prestador só enxerga a própria agenda — o filtro vale na consulta, não só na tela.
  const allProviders = perms.seeAll ? await listProviders() : [{ id: user.id, name: user.name }];
  const providerFilter = perms.seeAll ? allProviders.find((p) => p.id === params.prestador)?.id : user.id;

  const rangeStart = view === "semana" ? weekStart(day) : day;
  const { from, to } = localRange(rangeStart, view === "semana" ? 7 : 1);

  const [appointments, services, customers] = await Promise.all([
    listAppointments({ from, to, providerId: providerFilter }),
    listServices({ includeCost: false }),
    perms.schedule ? listCustomers() : Promise.resolve([]),
  ]);

  return (
    <>
      <PageHeader
        title={perms.seeAll ? "Agenda" : "Minha agenda"}
        description={perms.seeAll ? "Atendimentos por prestador. Clique num horário vago para agendar." : "Seus atendimentos. Clique num atendimento para iniciar ou concluir."}
      />
      <AgendaView
        key={`${view}-${rangeStart}-${providerFilter ?? "todos"}`}
        view={view}
        day={day}
        rangeStart={rangeStart}
        days={view === "semana" ? Array.from({ length: 7 }, (_, i) => addDays(rangeStart, i)) : [day]}
        today={today}
        appointments={appointments}
        providers={allProviders}
        providerFilter={providerFilter ?? null}
        services={services.map((s) => ({ id: s.id, name: s.name, durationMin: s.durationMin, price: s.price }))}
        customers={customers}
        perms={perms}
        currentUserId={user.id}
      />
    </>
  );
}

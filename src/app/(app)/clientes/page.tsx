import Link from "next/link";
import { ArrowDown, Search } from "lucide-react";
import { requirePermission } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { formatBRL } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { agoLabel, formatLocalDate, formatLocalDateTime } from "@/lib/time";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/page-header";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { INACTIVE_DAYS, listCustomerSummaries, type CustomerFilter, type CustomerSort } from "@/server/services/customers";
import { NewCustomerButton } from "./customer-dialogs";

export const metadata = { title: "Clientes" };

const FILTERS: { key: CustomerFilter; label: string; hint: string }[] = [
  { key: "todos", label: "Clientes", hint: "Cadastrados" },
  { key: "agendados", label: "Com horário marcado", hint: "Têm atendimento pela frente" },
  { key: "sumidos", label: "Sumidos", hint: `Sem vir há mais de ${INACTIVE_DAYS} dias` },
  { key: "novos", label: "Novos", hint: "Cadastrados nos últimos 30 dias" },
];
const SORTS: { key: CustomerSort; label: string }[] = [
  { key: "nome", label: "Nome" },
  { key: "recentes", label: "Última visita" },
  { key: "visitas", label: "Atendimentos" },
  { key: "gasto", label: "Gasto" },
];
const PAGE = 100;

type Props = { searchParams: Promise<{ q?: string; filtro?: string; ordem?: string }> };

export default async function ClientesPage({ searchParams }: Props) {
  const { user } = await requirePermission("cliente", "ver");
  const params = await searchParams;
  const q = (params.q ?? "").slice(0, 80);
  const filter = (FILTERS.find((f) => f.key === params.filtro)?.key ?? "todos") as CustomerFilter;
  const sort = (SORTS.find((s) => s.key === params.ordem)?.key ?? (filter === "sumidos" ? "recentes" : "nome")) as CustomerSort;

  const now = new Date();
  const { customers, counts } = await listCustomerSummaries({ q, filter, sort, now });
  const shown = customers.slice(0, PAGE);
  const manage = can(user.role, "cliente", "gerenciar");

  const href = (p: { filtro?: string; ordem?: string }) => {
    const sp = new URLSearchParams();
    if (q) sp.set("q", q);
    const f = p.filtro ?? filter;
    if (f !== "todos") sp.set("filtro", f);
    if (p.ordem) sp.set("ordem", p.ordem);
    const s = sp.toString();
    return s ? `/clientes?${s}` : "/clientes";
  };

  return (
    <>
      <PageHeader
        title="Clientes"
        description="Quem você atende: histórico de atendimentos e compras, contato e quem não volta há um tempo."
        actions={manage ? <NewCustomerButton /> : undefined}
      />

      <nav aria-label="Filtrar clientes" className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={href({ filtro: f.key })}
            aria-current={filter === f.key ? "page" : undefined}
            className={cn(
              "rounded-xl border p-5 transition-colors hover:bg-accent/60",
              filter === f.key && "border-primary bg-primary/5 ring-1 ring-primary",
            )}
          >
            <p className="text-sm text-muted-foreground">{f.label}</p>
            <p className={cn("mt-1 text-2xl font-semibold tracking-tight tabular-nums", f.key === "sumidos" && counts.sumidos > 0 && "text-warning-foreground")}>
              {counts[f.key]}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{f.hint}</p>
          </Link>
        ))}
      </nav>

      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <form action="/clientes" className="relative w-full sm:max-w-sm" role="search">
          {filter !== "todos" && <input type="hidden" name="filtro" value={filter} />}
          {params.ordem && <input type="hidden" name="ordem" value={sort} />}
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input name="q" defaultValue={q} placeholder="Buscar por nome ou telefone" aria-label="Buscar clientes" className="pl-9" />
        </form>
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {customers.length === 0 ? "Nenhum cliente" : customers.length === 1 ? "1 cliente" : `${customers.length} clientes`}
          {customers.length > PAGE && ` · mostrando os primeiros ${PAGE}, refine a busca`}
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <SortHead label="Cliente" sortKey="nome" current={sort} href={href({ ordem: "nome" })} />
              <SortHead label="Atendimentos" sortKey="visitas" current={sort} href={href({ ordem: "visitas" })} className="text-right" />
              <SortHead label="Última visita" sortKey="recentes" current={sort} href={href({ ordem: "recentes" })} />
              <TableHead>Próximo horário</TableHead>
              <SortHead label="Serviços" sortKey="gasto" current={sort} href={href({ ordem: "gasto" })} className="text-right" />
              <TableHead className="text-right">Produtos</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {shown.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={6} className="h-32 text-center text-muted-foreground whitespace-normal">
                  {q ? `Nenhum cliente encontrado para "${q}".` : filter === "sumidos" ? "Ninguém sumido. Todos os clientes voltaram recentemente." : "Nenhum cliente por aqui ainda. Eles são cadastrados ao agendar ou pelo botão Novo cliente."}
                </TableCell>
              </TableRow>
            )}
            {shown.map((c) => (
              <TableRow key={c.id} className="relative">
                <TableCell className="whitespace-normal">
                  <Link href={`/clientes/${c.id}`} className="font-medium after:absolute after:inset-0 hover:underline underline-offset-4">
                    {c.name}
                  </Link>
                  {c.phone && <span className="block text-xs text-muted-foreground tabular-nums">{formatPhone(c.phone)}</span>}
                </TableCell>
                <TableCell className="text-right tabular-nums">
                  {c.visits}
                  {c.cancelled > 0 && <span className="block text-xs text-muted-foreground">{c.cancelled} cancel.</span>}
                </TableCell>
                <TableCell className="tabular-nums">
                  {c.lastActivity ? (
                    <>
                      {formatLocalDate(c.lastActivity)}
                      <span className="block text-xs text-muted-foreground">{agoLabel(c.lastActivity, now)}</span>
                    </>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
                <TableCell className="tabular-nums">{c.nextAppointment ? formatLocalDateTime(c.nextAppointment) : <span className="text-muted-foreground">—</span>}</TableCell>
                <TableCell className="text-right font-medium tabular-nums">{formatBRL(c.servicesTotal)}</TableCell>
                <TableCell className="text-right tabular-nums text-muted-foreground">
                  {c.purchases > 0 ? formatBRL(c.productsTotal) : "—"}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <p className="mt-3 text-xs text-muted-foreground">
        Serviços: soma dos atendimentos concluídos. Produtos: compras em que o cliente foi escolhido no caixa.
      </p>
    </>
  );
}

function SortHead({ label, sortKey, current, href, className }: { label: string; sortKey: CustomerSort; current: CustomerSort; href: string; className?: string }) {
  const active = current === sortKey;
  return (
    <TableHead className={className} aria-sort={active ? (sortKey === "nome" ? "ascending" : "descending") : undefined}>
      <Link href={href} className={cn("inline-flex items-center gap-1 hover:text-foreground", active && "text-foreground")}>
        {label}
        {active && <ArrowDown className={cn("size-3.5", sortKey === "nome" && "rotate-180")} aria-hidden />}
      </Link>
    </TableHead>
  );
}

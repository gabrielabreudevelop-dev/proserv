import Link from "next/link";
import { redirect } from "next/navigation";
import { Search } from "lucide-react";
import { requireSession } from "@/lib/auth/guards";
import { prisma } from "@/lib/db";
import { monthRange } from "@/lib/finance-shared";
import { isAdmin } from "@/lib/nav";
import { MonthPicker, parseMonthParam } from "@/components/month-picker";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/form-controls";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AUDIT_ENTITIES, listAudit } from "@/server/services/audit";

export const metadata = { title: "Auditoria" };

const PAGE_SIZE = 50;
const dt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "America/Sao_Paulo" });
const show = (v: unknown) => (v === null || v === undefined || v === "" ? "—" : typeof v === "boolean" ? (v ? "Sim" : "Não") : String(v));

type Props = { searchParams: Promise<{ mes?: string; area?: string; pessoa?: string; q?: string; pagina?: string }> };

export default async function AuditoriaPage({ searchParams }: Props) {
  const { user } = await requireSession();
  if (!isAdmin(user.role)) redirect("/sem-acesso");

  const p = await searchParams;
  const month = parseMonthParam(p.mes);
  const { from, to } = monthRange(month);
  const entity = p.area && p.area in AUDIT_ENTITIES ? p.area : undefined;
  const page = Math.max(1, Number(p.pagina) || 1);
  const q = p.q?.trim().slice(0, 80) || undefined;

  const [{ rows, total }, people] = await Promise.all([
    listAudit({ from, to, entity, actorId: p.pessoa || undefined, q, page, pageSize: PAGE_SIZE }),
    prisma.user.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const qs = (patch: Record<string, string | number | undefined>) => {
    const u = new URLSearchParams();
    const all = { mes: month, area: entity, pessoa: p.pessoa, q, pagina: page, ...patch };
    for (const [k, v] of Object.entries(all)) if (v !== undefined && v !== "" && !(k === "pagina" && v === 1)) u.set(k, String(v));
    return `/config/auditoria?${u}`;
  };

  return (
    <>
      <PageHeader title="Auditoria" description="Quem fez o quê e quando. O registro não pode ser editado nem apagado." actions={<MonthPicker month={month} basePath="/config/auditoria" />} />

      <form method="get" className="mb-4 flex flex-wrap items-end gap-2">
        <input type="hidden" name="mes" value={month} />
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input name="q" defaultValue={q} placeholder="Buscar no registro…" aria-label="Buscar no registro" className="pl-9" />
        </div>
        <NativeSelect name="area" defaultValue={entity ?? ""} aria-label="Área" className="w-auto min-w-40">
          <option value="">Todas as áreas</option>
          {Object.entries(AUDIT_ENTITIES).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect name="pessoa" defaultValue={p.pessoa ?? ""} aria-label="Pessoa" className="w-auto min-w-44">
          <option value="">Todas as pessoas</option>
          {people.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </NativeSelect>
        <Button type="submit" variant="outline">
          Filtrar
        </Button>
        {(entity || p.pessoa || q) && (
          <Button variant="ghost" asChild>
            <Link href={`/config/auditoria?mes=${month}`}>Limpar</Link>
          </Button>
        )}
        <span className="ml-auto text-sm text-muted-foreground tabular-nums">{total} registro(s)</span>
      </form>

      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-36">Quando</TableHead>
              <TableHead className="w-44">Quem</TableHead>
              <TableHead className="w-36">Área</TableHead>
              <TableHead>O que aconteceu</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={4} className="h-28 text-center text-muted-foreground">
                  Nenhum registro com esses filtros.
                </TableCell>
              </TableRow>
            )}
            {rows.map((r) => (
              <TableRow key={r.id} className="align-top">
                <TableCell className="tabular-nums text-muted-foreground">{dt.format(new Date(r.createdAt))}</TableCell>
                <TableCell>{r.actorName}</TableCell>
                <TableCell className="text-muted-foreground">{AUDIT_ENTITIES[r.entity as keyof typeof AUDIT_ENTITIES] ?? r.entity}</TableCell>
                <TableCell className="whitespace-normal">
                  <p>{r.summary}</p>
                  {r.changes && (
                    <dl className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
                      {Object.entries(r.changes).map(([field, [before, after]]) => (
                        <div key={field} className="contents">
                          <dt className="text-muted-foreground">{field}</dt>
                          <dd className="tabular-nums">
                            <span className="text-destructive line-through">{show(before)}</span> → <span className="text-success">{show(after)}</span>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {pages > 1 && (
        <nav className="mt-4 flex items-center justify-end gap-2 text-sm" aria-label="Paginação">
          <span className="text-muted-foreground tabular-nums">
            Página {page} de {pages}
          </span>
          <Button variant="outline" size="sm" asChild aria-disabled={page <= 1}>
            <Link href={qs({ pagina: page - 1 })} className={page <= 1 ? "pointer-events-none opacity-40" : undefined}>
              Anterior
            </Link>
          </Button>
          <Button variant="outline" size="sm" asChild aria-disabled={page >= pages}>
            <Link href={qs({ pagina: page + 1 })} className={page >= pages ? "pointer-events-none opacity-40" : undefined}>
              Próxima
            </Link>
          </Button>
        </nav>
      )}
    </>
  );
}

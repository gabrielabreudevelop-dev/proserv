import Link from "next/link";
import { requirePermission } from "@/lib/auth/guards";
import { can } from "@/lib/auth/permissions";
import { EXPENSE_CATEGORIES, LEDGER_KIND_LABELS, monthRange, type LedgerKindName } from "@/lib/finance-shared";
import { formatBRL, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Kpi, MonthPicker, parseMonthParam } from "@/components/month-picker";
import { PageHeader } from "@/components/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { incomeStatement, listLedger } from "@/server/services/finance";
import { ExpenseButton, ReverseExpenseButton } from "./finance-client";

export const metadata = { title: "Financeiro" };

const FILTERS: { key: string; label: string; kind?: LedgerKindName }[] = [
  { key: "", label: "Todos" },
  { key: "receitas", label: "Receitas", kind: "RECEITA_PRODUTO" },
  { key: "cmv", label: "CMV", kind: "CMV" },
  { key: "despesas", label: "Despesas", kind: "DESPESA" },
  { key: "estornos", label: "Estornos", kind: "ESTORNO" },
];

const dateFmt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

type Props = { searchParams: Promise<{ mes?: string; tipo?: string }> };

export default async function FinanceiroPage({ searchParams }: Props) {
  const { user } = await requirePermission("financeiro", "ver");
  const params = await searchParams;
  const month = parseMonthParam(params.mes);
  const filter = FILTERS.find((f) => f.key === params.tipo) ?? FILTERS[0];
  const { from, to } = monthRange(month);
  const canPost = can(user.role, "financeiro", "lancar");

  const [dre, ledger] = await Promise.all([incomeStatement(from, to), listLedger({ from, to, kind: filter.kind })]);

  const resultado = Number(dre.resultado);
  const isProfit = resultado >= 0;
  const maxCat = Math.max(...dre.despesasPorCategoria.map((c) => Number(c.amount)), 1);

  const dreRows: { label: string; value: string; strong?: boolean; indent?: boolean; sign?: "-" }[] = [
    { label: "Receita de produtos", value: dre.receitaProdutos, indent: true },
    { label: "Receita de serviços", value: dre.receitaServicos, indent: true },
    { label: "(−) Cancelamentos", value: dre.cancelamentos, indent: true },
    { label: "Receita líquida", value: dre.receitaLiquida, strong: true },
    { label: "(−) Custo das mercadorias vendidas", value: `-${dre.cmv}`, indent: true },
    { label: "Lucro bruto", value: dre.lucroBruto, strong: true },
    { label: "(−) Despesas", value: `-${dre.despesas}`, indent: true },
  ];

  const qs = (tipo: string) => `/financeiro?mes=${month}${tipo ? `&tipo=${tipo}` : ""}`;

  return (
    <>
      <PageHeader
        title="Financeiro"
        description="Resultado calculado a partir de cada venda, perda e despesa do período"
        actions={
          <>
            <MonthPicker month={month} basePath="/financeiro" />
            {canPost && <ExpenseButton categories={[...EXPENSE_CATEGORIES]} />}
          </>
        }
      />

      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi label="Receita líquida" value={formatBRL(dre.receitaLiquida)} hint={`${dre.vendasConcluidas} venda(s) concluída(s)`} />
        <Kpi label="Custo das mercadorias" value={formatBRL(dre.cmv)} hint={dre.margemBruta !== null ? `Margem bruta ${formatPct(dre.margemBruta)}` : undefined} />
        <Kpi label="Despesas" value={formatBRL(dre.despesas)} />
        <Kpi label={isProfit ? "Lucro do mês" : "Prejuízo do mês"} value={formatBRL(Math.abs(resultado))} tone={isProfit ? "positive" : "negative"} hint="Receita − custo − despesas" />
      </div>

      <div className="mb-8 grid gap-6 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)]">
        <section aria-labelledby="dre-title" className="rounded-xl border">
          <h2 id="dre-title" className="border-b px-5 py-3.5 text-sm font-medium">
            Demonstrativo do resultado
          </h2>
          <table className="w-full text-sm">
            <tbody>
              {dreRows.map((r) => (
                <tr key={r.label} className={cn("border-b last:border-0", r.strong && "bg-muted/40")}>
                  <td className={cn("px-5 py-2.5", r.indent && "pl-8 text-muted-foreground", r.strong && "font-medium")}>{r.label}</td>
                  <td className={cn("px-5 py-2.5 text-right tabular-nums", r.strong && "font-medium")}>{formatBRL(r.value)}</td>
                </tr>
              ))}
              <tr className="bg-muted/60">
                <td className="px-5 py-3 font-semibold">{isProfit ? "Lucro" : "Prejuízo"}</td>
                <td className={cn("px-5 py-3 text-right text-base font-semibold tabular-nums", isProfit ? "text-success" : "text-destructive")} data-testid="dre-resultado">
                  {formatBRL(dre.resultado)}
                </td>
              </tr>
            </tbody>
          </table>
        </section>

        <section aria-labelledby="cat-title" className="rounded-xl border">
          <h2 id="cat-title" className="border-b px-5 py-3.5 text-sm font-medium">
            Despesas por categoria
          </h2>
          {dre.despesasPorCategoria.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-muted-foreground">Nenhuma despesa no período.</p>
          ) : (
            <ul className="space-y-3 px-5 py-4">
              {dre.despesasPorCategoria.map((c) => (
                <li key={c.category} className="text-sm">
                  <div className="mb-1 flex justify-between gap-3">
                    <span>{c.category}</span>
                    <span className="tabular-nums">{formatBRL(c.amount)}</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-muted" aria-hidden>
                    <div className="h-1.5 rounded-full bg-primary/70" style={{ width: `${(Number(c.amount) / maxCat) * 100}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <section aria-labelledby="ledger-title" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="ledger-title" className="text-sm font-medium">
            Lançamentos <span className="text-muted-foreground">· {ledger.length}</span>
          </h2>
          <nav className="inline-flex rounded-lg border bg-muted p-0.5" aria-label="Filtrar lançamentos">
            {FILTERS.map((f) => (
              <Link
                key={f.key}
                href={qs(f.key)}
                aria-current={f.key === filter.key ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1 text-sm text-muted-foreground",
                  f.key === filter.key && "bg-background font-medium text-foreground shadow-sm",
                )}
              >
                {f.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="overflow-hidden rounded-xl border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Data</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Categoria</TableHead>
                <TableHead>Por</TableHead>
                <TableHead className="text-right">Valor</TableHead>
                {canPost && (
                  <TableHead className="w-24">
                    <span className="sr-only">Ações</span>
                  </TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {ledger.length === 0 && (
                <TableRow className="hover:bg-transparent">
                  <TableCell colSpan={canPost ? 7 : 6} className="h-28 text-center text-muted-foreground">
                    Nenhum lançamento.
                  </TableCell>
                </TableRow>
              )}
              {ledger.map((e) => {
                const amount = Number(e.amount);
                return (
                  <TableRow key={e.id} className={cn(e.reversed && "text-muted-foreground")}>
                    <TableCell className="tabular-nums">{dateFmt.format(new Date(e.occurredAt))}</TableCell>
                    <TableCell>{LEDGER_KIND_LABELS[e.kind]}</TableCell>
                    <TableCell className="max-w-80 truncate" title={e.description}>
                      <span className={cn(e.reversed && "line-through")}>{e.description}</span>
                      {e.reversed && <span className="ml-2 text-xs">(estornada)</span>}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{e.category ?? "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{e.createdBy}</TableCell>
                    <TableCell className={cn("text-right font-medium tabular-nums", amount < 0 ? "text-destructive" : "text-success")}>
                      {amount > 0 ? "+" : ""}
                      {formatBRL(amount)}
                    </TableCell>
                    {canPost && <TableCell className="py-1 text-right">{e.reversible && <ReverseExpenseButton id={e.id} description={e.description} />}</TableCell>}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        {ledger.length === 500 && <p className="text-xs text-muted-foreground">Mostrando os 500 lançamentos mais recentes do mês.</p>}
      </section>
    </>
  );
}

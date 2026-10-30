"use client";

import { Fragment, useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  flexRender,
  getCoreRowModel,
  getExpandedRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
  type FilterFn,
  type SortingFn,
  type SortingState,
  type VisibilityState,
} from "@tanstack/react-table";
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Columns3,
  MoreHorizontal,
  PackagePlus,
  Pencil,
  Plus,
  Power,
  Search,
  SlidersVertical,
} from "lucide-react";
import { toast } from "sonner";
import type { FieldDef } from "@/lib/custom-fields";
import { formatBRL, formatPct, formatQty } from "@/lib/format";
import { stockStatus } from "@/lib/stock-shared";
import { cn } from "@/lib/utils";
import type { ProductRow } from "@/server/services/products";
import type { TableState } from "@/server/services/table-prefs";
import { saveProductTablePrefAction, setProductActiveAction } from "@/server/actions/products";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/form-controls";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { CustomValue, StockCell } from "./cells";
import { ProductDetails } from "./product-details";
import { ProductFormSheet } from "./product-form-sheet";
import { StockDialog } from "./stock-dialog";

export type Perms = { seeCost: boolean; create: boolean; edit: boolean; stock: boolean; manageFields: boolean };

type Props = {
  products: ProductRow[];
  fields: FieldDef[];
  categories: string[];
  perms: Perms;
  savedState: TableState | null;
};

const FIXED_LABELS: Record<string, string> = {
  sku: "SKU",
  category: "Categoria",
  salePrice: "Preço de venda",
  avgCost: "Custo médio",
  margin: "Margem",
  stockQty: "Estoque",
};

const collator = new Intl.Collator("pt-BR", { sensitivity: "base", numeric: true });
const textSort: SortingFn<ProductRow> = (a, b, id) => {
  const x = a.getValue<string | null | undefined>(id);
  const y = b.getValue<string | null | undefined>(id);
  if (x == null) return y == null ? 0 : 1;
  if (y == null) return -1;
  return collator.compare(String(x), String(y));
};

const searchFilter: FilterFn<ProductRow> = (row, _id, value: string) => {
  const q = value.trim().toLowerCase();
  if (!q) return true;
  const p = row.original;
  const haystack = [p.sku, p.name, p.category ?? "", ...Object.values(p.customFields).map(String)].join(" ").toLowerCase();
  return q.split(/\s+/).every((term) => haystack.includes(term));
};

function margin(p: ProductRow) {
  const price = Number(p.salePrice);
  if (!p.avgCost || price <= 0) return null;
  return (price - Number(p.avgCost)) / price;
}

function SortHeader({ label, sorted, onClick, align = "left" }: { label: string; sorted: false | "asc" | "desc"; onClick: (event: unknown) => void; align?: "left" | "right" }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("inline-flex items-center gap-1 hover:text-foreground", align === "right" && "w-full justify-end")}
    >
      {label}
      {sorted === "asc" ? <ArrowUp className="size-3" /> : sorted === "desc" ? <ArrowDown className="size-3" /> : null}
    </button>
  );
}

export function ProductsTable({ products, fields, categories, perms, savedState }: Props) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [sorting, setSorting] = useState<SortingState>([{ id: "name", desc: false }]);
  const [form, setForm] = useState<{ mode: "create" } | { mode: "edit"; product: ProductRow } | null>(null);
  const [stockAction, setStockAction] = useState<{ kind: "entry" | "adjust"; product: ProductRow } | null>(null);
  const [, startTransition] = useTransition();

  // Colunas visíveis: preferência salva → padrão do campo (visibleByDefault).
  const [columnVisibility, setColumnVisibility] = useState<VisibilityState>(() => {
    const defaults: VisibilityState = {};
    for (const f of fields) defaults[`cf_${f.key}`] = f.visibleByDefault;
    return { ...defaults, ...(savedState?.columnVisibility ?? {}) };
  });
  const [pageSize, setPageSize] = useState(savedState?.pageSize ?? 20);

  // Salva a preferência 600 ms depois da última mudança.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => {
      void saveProductTablePrefAction({ columnVisibility, pageSize });
    }, 600);
    return () => clearTimeout(t);
  }, [columnVisibility, pageSize]);

  const data = useMemo(
    () =>
      products.filter((p) => {
        if (!showInactive && !p.active) return false;
        if (category && p.category !== category) return false;
        if (lowOnly && stockStatus(Number(p.stockQty), p.minStock === null ? null : Number(p.minStock)) === "ok") return false;
        return true;
      }),
    [products, showInactive, category, lowOnly],
  );

  const lowCount = useMemo(
    () => products.filter((p) => p.active && stockStatus(Number(p.stockQty), p.minStock === null ? null : Number(p.minStock)) !== "ok").length,
    [products],
  );

  function toggleActive(p: ProductRow) {
    startTransition(async () => {
      const res = await setProductActiveAction(p.id, !p.active);
      if (!res.ok) return void toast.error(res.error);
      toast.success(p.active ? `"${p.name}" desativado` : `"${p.name}" reativado`, {
        action: p.active ? { label: "Desfazer", onClick: () => void setProductActiveAction(p.id, true) } : undefined,
      });
    });
  }

  const columns = useMemo<ColumnDef<ProductRow>[]>(() => {
    const cols: ColumnDef<ProductRow>[] = [
      {
        id: "expand",
        enableHiding: false,
        enableSorting: false,
        header: () => <span className="sr-only">Detalhes</span>,
        cell: ({ row }) => (
          <button
            type="button"
            onClick={row.getToggleExpandedHandler()}
            aria-expanded={row.getIsExpanded()}
            aria-label={row.getIsExpanded() ? "Recolher detalhes" : "Ver detalhes"}
            className="grid size-6 place-items-center rounded text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <ChevronRight className={cn("size-4 transition-transform", row.getIsExpanded() && "rotate-90")} />
          </button>
        ),
      },
      {
        accessorKey: "sku",
        sortingFn: textSort,
        header: ({ column }) => <SortHeader label="SKU" sorted={column.getIsSorted()} onClick={column.getToggleSortingHandler()!} />,
        cell: ({ getValue }) => <span className="font-mono text-xs text-muted-foreground">{getValue<string>()}</span>,
      },
      {
        accessorKey: "name",
        enableHiding: false,
        sortingFn: textSort,
        header: ({ column }) => <SortHeader label="Produto" sorted={column.getIsSorted()} onClick={column.getToggleSortingHandler()!} />,
        cell: ({ row }) => (
          <span className="flex items-center gap-2">
            <span className={cn("font-medium", !row.original.active && "text-muted-foreground line-through")}>{row.original.name}</span>
            {!row.original.active && <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Inativo</span>}
          </span>
        ),
      },
      {
        accessorKey: "category",
        sortingFn: textSort,
        header: ({ column }) => <SortHeader label="Categoria" sorted={column.getIsSorted()} onClick={column.getToggleSortingHandler()!} />,
        cell: ({ getValue }) => getValue<string | null>() ?? <span className="text-muted-foreground/60">—</span>,
      },
      {
        id: "salePrice",
        accessorFn: (p) => Number(p.salePrice),
        header: ({ column }) => <SortHeader align="right" label="Preço de venda" sorted={column.getIsSorted()} onClick={column.getToggleSortingHandler()!} />,
        cell: ({ row }) => <span className="block text-right tabular-nums">{formatBRL(row.original.salePrice)}</span>,
      },
    ];

    if (perms.seeCost) {
      cols.push(
        {
          id: "avgCost",
          accessorFn: (p) => Number(p.avgCost ?? 0),
          header: ({ column }) => <SortHeader align="right" label="Custo médio" sorted={column.getIsSorted()} onClick={column.getToggleSortingHandler()!} />,
          cell: ({ row }) => <span className="block text-right tabular-nums text-muted-foreground">{formatBRL(row.original.avgCost ?? 0)}</span>,
        },
        {
          id: "margin",
          accessorFn: (p) => margin(p) ?? -Infinity,
          header: ({ column }) => <SortHeader align="right" label="Margem" sorted={column.getIsSorted()} onClick={column.getToggleSortingHandler()!} />,
          cell: ({ row }) => {
            const m = margin(row.original);
            if (m === null || Number(row.original.avgCost) === 0) return <span className="block text-right text-muted-foreground/60">—</span>;
            return <span className={cn("block text-right tabular-nums", m < 0 && "font-medium text-destructive")}>{formatPct(m)}</span>;
          },
        },
      );
    }

    cols.push({
      id: "stockQty",
      accessorFn: (p) => Number(p.stockQty),
      header: ({ column }) => <SortHeader align="right" label="Estoque" sorted={column.getIsSorted()} onClick={column.getToggleSortingHandler()!} />,
      cell: ({ row }) => (
        <span className="flex justify-end">
          <StockCell stockQty={row.original.stockQty} minStock={row.original.minStock} />
        </span>
      ),
    });

    // Uma coluna por campo personalizado ativo, na ordem definida em /produtos/campos.
    for (const def of fields) {
      cols.push({
        id: `cf_${def.key}`,
        accessorFn: (p) => {
          const v = p.customFields[def.key];
          if (v === undefined) return undefined;
          return def.type === "NUMBER" ? Number(v) : def.type === "BOOLEAN" ? (v ? 1 : 0) : String(v);
        },
        sortUndefined: "last",
        ...(def.type === "TEXT" || def.type === "SELECT" ? { sortingFn: textSort } : {}),
        meta: { label: def.label },
        header: ({ column }) => (
          <SortHeader
            align={def.type === "NUMBER" ? "right" : "left"}
            label={def.label}
            sorted={column.getIsSorted()}
            onClick={column.getToggleSortingHandler()!}
          />
        ),
        cell: ({ row }) => (
          <span className={cn("block", def.type === "NUMBER" && "text-right")}>
            <CustomValue def={def} value={row.original.customFields[def.key]} />
          </span>
        ),
      });
    }

    if (perms.edit || perms.stock) {
      cols.push({
        id: "actions",
        enableHiding: false,
        enableSorting: false,
        header: () => <span className="sr-only">Ações</span>,
        cell: ({ row }) => {
          const p = row.original;
          return (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="size-8" aria-label={`Ações de ${p.name}`}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {perms.edit && (
                  <DropdownMenuItem onSelect={() => setForm({ mode: "edit", product: p })}>
                    <Pencil /> Editar
                  </DropdownMenuItem>
                )}
                {perms.stock && p.active && (
                  <>
                    <DropdownMenuItem onSelect={() => setStockAction({ kind: "entry", product: p })}>
                      <PackagePlus /> Entrada de estoque
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setStockAction({ kind: "adjust", product: p })}>
                      <SlidersVertical /> Ajustar estoque
                    </DropdownMenuItem>
                  </>
                )}
                {perms.edit && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant={p.active ? "destructive" : "default"} onSelect={() => toggleActive(p)}>
                      <Power /> {p.active ? "Desativar" : "Reativar"}
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          );
        },
      });
    }
    return cols;
  }, [fields, perms]);

  const table = useReactTable({
    data,
    columns,
    state: { sorting, columnVisibility, globalFilter: search },
    initialState: { pagination: { pageSize } },
    onSortingChange: setSorting,
    onColumnVisibilityChange: setColumnVisibility,
    onGlobalFilterChange: setSearch,
    globalFilterFn: searchFilter,
    getRowId: (p) => p.id,
    getRowCanExpand: () => true,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
    autoResetPageIndex: false,
  });

  const hideable = table.getAllLeafColumns().filter((c) => c.getCanHide());
  const filteredCount = table.getFilteredRowModel().rows.length;
  const { pageIndex } = table.getState().pagination;
  const pageCount = table.getPageCount();
  const visibleCols = table.getVisibleLeafColumns().length;
  const filtersActive = Boolean(search || category || lowOnly);

  return (
    <div className="space-y-4">
      {/* Barra de ferramentas */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-72">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              table.setPageIndex(0);
            }}
            placeholder="Buscar por nome, SKU, lote…"
            aria-label="Buscar produtos"
            className="pl-9"
          />
        </div>
        <NativeSelect
          value={category}
          onChange={(e) => {
            setCategory(e.target.value);
            table.setPageIndex(0);
          }}
          aria-label="Filtrar por categoria"
          className="w-auto min-w-40"
        >
          <option value="">Todas as categorias</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </NativeSelect>
        <Button
          variant={lowOnly ? "secondary" : "outline"}
          aria-pressed={lowOnly}
          onClick={() => {
            setLowOnly((v) => !v);
            table.setPageIndex(0);
          }}
        >
          Estoque baixo
          {lowCount > 0 && (
            <span className="rounded-full bg-warning/25 px-1.5 text-xs font-semibold text-warning-foreground tabular-nums">{lowCount}</span>
          )}
        </Button>
        {perms.edit && (
          <label className="ml-1 flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" className="size-4 accent-primary" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
            Mostrar inativos
          </label>
        )}

        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Columns3 /> Colunas <ChevronDown className="size-3.5 opacity-60" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="max-h-96 w-56 overflow-y-auto">
              <DropdownMenuLabel className="text-xs text-muted-foreground">Exibir colunas</DropdownMenuLabel>
              {hideable.map((col) => (
                <DropdownMenuCheckboxItem
                  key={col.id}
                  checked={col.getIsVisible()}
                  onCheckedChange={(v) => col.toggleVisibility(Boolean(v))}
                  onSelect={(e) => e.preventDefault()}
                >
                  {(col.columnDef.meta as { label?: string } | undefined)?.label ?? FIXED_LABELS[col.id] ?? col.id}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {perms.create && (
            <Button onClick={() => setForm({ mode: "create" })}>
              <Plus /> Novo produto
            </Button>
          )}
        </div>
      </div>

      {/* Tabela */}
      <div className="overflow-hidden rounded-xl border">
        <Table>
          <TableHeader>
            {table.getHeaderGroups().map((hg) => (
              <TableRow key={hg.id} className="hover:bg-transparent">
                {hg.headers.map((h) => (
                  <TableHead
                    key={h.id}
                    className={cn(h.column.id === "expand" && "w-10 pr-0", h.column.id === "actions" && "w-12")}
                    aria-sort={h.column.getIsSorted() === "asc" ? "ascending" : h.column.getIsSorted() === "desc" ? "descending" : undefined}
                  >
                    {h.isPlaceholder ? null : flexRender(h.column.columnDef.header, h.getContext())}
                  </TableHead>
                ))}
              </TableRow>
            ))}
          </TableHeader>
          <TableBody>
            {table.getRowModel().rows.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={visibleCols} className="h-40 text-center text-muted-foreground">
                  {products.length === 0 ? (
                    <div className="space-y-3">
                      <p>Nenhum produto cadastrado ainda.</p>
                      {perms.create && (
                        <Button size="sm" onClick={() => setForm({ mode: "create" })}>
                          <Plus /> Cadastrar o primeiro
                        </Button>
                      )}
                    </div>
                  ) : (
                    "Nenhum produto encontrado com esses filtros."
                  )}
                </TableCell>
              </TableRow>
            ) : (
              table.getRowModel().rows.map((row) => (
                <Fragment key={row.id}>
                  <TableRow data-state={row.getIsExpanded() ? "selected" : undefined} className={cn(!row.original.active && "opacity-60")}>
                    {row.getVisibleCells().map((cell) => (
                      <TableCell key={cell.id} className={cn(cell.column.id === "expand" && "pr-0", cell.column.id === "actions" && "py-1")}>
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </TableCell>
                    ))}
                  </TableRow>
                  {row.getIsExpanded() && (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell colSpan={visibleCols} className="whitespace-normal p-0">
                        <ProductDetails product={row.original} fields={fields} seeCost={perms.seeCost} />
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Rodapé: contagem e paginação */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted-foreground">
        <p>
          {filtersActive || showInactive ? `${formatQty(filteredCount)} de ${formatQty(products.length)} produtos` : `${formatQty(filteredCount)} produtos`}
        </p>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2">
            Por página
            <NativeSelect
              value={pageSize}
              onChange={(e) => {
                const size = Number(e.target.value);
                setPageSize(size);
                table.setPageSize(size);
              }}
              className="h-8 w-20"
            >
              {[10, 20, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </NativeSelect>
          </label>
          <span className="tabular-nums">
            Página {pageCount === 0 ? 0 : pageIndex + 1} de {pageCount}
          </span>
          <div className="flex gap-1">
            <Button variant="outline" size="icon" className="size-8" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()} aria-label="Página anterior">
              <ChevronLeft />
            </Button>
            <Button variant="outline" size="icon" className="size-8" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()} aria-label="Próxima página">
              <ChevronRight />
            </Button>
          </div>
        </div>
      </div>

      <ProductFormSheet
        state={form}
        onClose={() => setForm(null)}
        fields={fields}
        categories={categories}
        canSetInitialStock={perms.stock}
      />
      <StockDialog state={stockAction} onClose={() => setStockAction(null)} seeCost={perms.seeCost} />
    </div>
  );
}

"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, Minus, Plus, Search, ShoppingCart, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PAYMENT_METHODS, type PaymentMethod } from "@/lib/finance-shared";
import { formatBRL, formatQty, parseDecimalInput } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SellableProduct } from "@/server/services/sales";
import type { CustomerOption } from "@/server/services/customers";
import { formatPhone } from "@/lib/phone";
import { createSaleAction } from "@/server/actions/sales";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Line = { product: SellableProduct; qty: string };

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const cents = (n: number) => Math.round(n * 100) / 100;

const customerLabel = (c: CustomerOption) => (c.phone ? `${c.name} · ${formatPhone(c.phone)}` : c.name);

export function PointOfSale({ products, customers }: { products: SellableProduct[]; customers: CustomerOption[] }) {
  const [query, setQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const [cart, setCart] = useState<Line[]>([]);
  const [discountRaw, setDiscountRaw] = useState("");
  const [discountMode, setDiscountMode] = useState<"valor" | "pct">("valor");
  const [payment, setPayment] = useState<PaymentMethod | null>(null);
  const [customerText, setCustomerText] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [pending, start] = useTransition();
  const searchRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // Estoque sempre do servidor (atualiza após cada venda).
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const lines = cart.map((l) => ({ ...l, product: byId.get(l.product.id) ?? l.product }));

  const results = useMemo(() => {
    const q = fold(query.trim());
    if (!q) return products.slice(0, 8);
    const terms = q.split(/\s+/);
    return products.filter((p) => terms.every((t) => fold(`${p.name} ${p.sku} ${p.category ?? ""}`).includes(t))).slice(0, 8);
  }, [products, query]);

  const inCart = (id: string) => lines.find((l) => l.product.id === id);
  const qtyOf = (l: Line) => Number(parseDecimalInput(l.qty) ?? 0);

  function add(p: SellableProduct) {
    const stock = Number(p.stock);
    const existing = inCart(p.id);
    const next = (existing ? qtyOf(existing) : 0) + 1;
    if (next > stock) {
      toast.warning(stock <= 0 ? `"${p.name}" está sem estoque.` : `Só há ${formatQty(stock)} de "${p.name}" em estoque.`);
      return;
    }
    setCart((c) => (existing ? c.map((l) => (l.product.id === p.id ? { ...l, qty: String(next) } : l)) : [...c, { product: p, qty: "1" }]));
    setQuery("");
    setHighlight(0);
    searchRef.current?.focus();
  }

  function setQty(id: string, qty: string) {
    setCart((c) => c.map((l) => (l.product.id === id ? { ...l, qty } : l)));
  }
  function step(id: string, delta: number) {
    const l = inCart(id)!;
    const next = Math.max(0, qtyOf(l) + delta);
    if (next === 0) return remove(id);
    setQty(id, String(next).replace(".", ","));
  }
  function remove(id: string) {
    setCart((c) => c.filter((l) => l.product.id !== id));
  }

  const subtotal = cents(lines.reduce((s, l) => s + cents(qtyOf(l) * Number(l.product.price)), 0));
  const discountInput = Number(parseDecimalInput(discountRaw) ?? 0);
  const discount = cents(discountMode === "pct" ? (subtotal * Math.min(discountInput, 100)) / 100 : discountInput);
  const total = cents(subtotal - discount);
  const problems = lines.filter((l) => qtyOf(l) <= 0 || qtyOf(l) > Number(l.product.stock));
  const discountInvalid = discount < 0 || discount > subtotal || (discountRaw !== "" && parseDecimalInput(discountRaw) === null);
  const typedCustomer = customerText.trim();
  const existingCustomer = typedCustomer
    ? customers.find((c) => customerLabel(c) === typedCustomer || c.name.toLowerCase() === typedCustomer.toLowerCase())
    : undefined;
  const newCustomer = typedCustomer.length > 0 && !existingCustomer;
  const customerInvalid = newCustomer && typedCustomer.length < 2;
  const canFinish = !customerInvalid && lines.length > 0 && problems.length === 0 && !discountInvalid && payment !== null && !pending;

  function onSearchKey(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter" && !e.ctrlKey && !e.metaKey) {
      e.preventDefault();
      const p = results[highlight];
      if (p) add(p);
    }
  }

  function finish() {
    if (!canFinish || !payment) return;
    start(async () => {
      const res = await createSaleAction({
        items: lines.map((l) => ({ productId: l.product.id, quantity: l.qty })),
        discount: discount.toFixed(2),
        paymentMethod: payment,
        customer: existingCustomer ? { id: existingCustomer.id } : newCustomer ? { name: typedCustomer, phone: customerPhone } : null,
      });
      if (!res.ok) return void toast.error(res.error);
      toast.success(`Venda nº ${res.data.number} registrada · ${formatBRL(res.data.total)}${existingCustomer ? ` · ${existingCustomer.name}` : newCustomer ? ` · ${typedCustomer}` : ""}`, {
        action: { label: "Ver vendas", onClick: () => router.push("/vendas") },
      });
      setCart([]);
      setDiscountRaw("");
      setPayment(null);
      setCustomerText("");
      setCustomerPhone("");
      searchRef.current?.focus();
    });
  }

  return (
    <div
      className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_420px]"
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          finish();
        }
      }}
    >
      {/* Busca */}
      <section aria-label="Produtos" className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            ref={searchRef}
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setHighlight(0);
            }}
            onKeyDown={onSearchKey}
            placeholder="Nome, SKU ou categoria"
            aria-label="Buscar produto"
            aria-controls="pdv-results"
            aria-activedescendant={results[highlight] ? `pdv-${results[highlight].id}` : undefined}
            className="h-11 pl-9 text-base"
          />
        </div>
        <ul id="pdv-results" role="listbox" aria-label="Resultados" className="divide-y overflow-hidden rounded-xl border">
          {results.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum produto encontrado.</li>}
          {results.map((p, i) => {
            const stock = Number(p.stock);
            const out = stock <= 0;
            return (
              <li
                key={p.id}
                id={`pdv-${p.id}`}
                role="option"
                aria-selected={i === highlight}
                aria-disabled={out}
                onMouseEnter={() => setHighlight(i)}
                onClick={() => add(p)}
                className={cn(
                  "flex cursor-pointer items-center gap-4 px-4 py-3 text-sm",
                  i === highlight && "bg-accent",
                  out && "cursor-not-allowed opacity-50",
                )}
              >
                <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">{p.sku}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{p.name}</span>
                  {p.category && <span className="text-xs text-muted-foreground">{p.category}</span>}
                </span>
                <span className={cn("w-24 text-right text-xs tabular-nums", out ? "text-destructive" : "text-muted-foreground")}>
                  {out ? "Sem estoque" : `${formatQty(stock)} em estoque`}
                </span>
                <span className="w-24 text-right font-medium tabular-nums">{formatBRL(p.price)}</span>
              </li>
            );
          })}
        </ul>
        <p className="text-xs text-muted-foreground">
          <kbd className="rounded border px-1">↑</kbd> <kbd className="rounded border px-1">↓</kbd> para escolher ·{" "}
          <kbd className="rounded border px-1">Enter</kbd> adiciona · <kbd className="rounded border px-1">Ctrl</kbd>+
          <kbd className="rounded border px-1">Enter</kbd> finaliza
        </p>
      </section>

      {/* Carrinho */}
      <section aria-label="Venda atual" className="sticky top-20 flex max-h-[calc(100dvh-6rem)] flex-col rounded-xl border bg-card">
        <header className="flex items-center justify-between border-b px-5 py-3.5">
          <h2 className="flex items-center gap-2 text-sm font-medium">
            <ShoppingCart className="size-4" aria-hidden /> Venda atual
          </h2>
          {lines.length > 0 && (
            <button type="button" onClick={() => setCart([])} className="text-xs text-muted-foreground hover:text-destructive">
              Limpar
            </button>
          )}
        </header>

        <div className="min-h-32 flex-1 overflow-y-auto">
          {lines.length === 0 ? (
            <p className="px-5 py-10 text-center text-sm text-muted-foreground">Nenhum item. Busque um produto ao lado.</p>
          ) : (
            <ul className="divide-y">
              {lines.map((l) => {
                const q = qtyOf(l);
                const over = q > Number(l.product.stock);
                return (
                  <li key={l.product.id} className="px-5 py-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{l.product.name}</p>
                        <p className="text-xs text-muted-foreground tabular-nums">{formatBRL(l.product.price)} cada</p>
                      </div>
                      <p className="text-sm font-medium tabular-nums">{formatBRL(cents(q * Number(l.product.price)))}</p>
                    </div>
                    <div className="mt-2 flex items-center gap-1">
                      <Button variant="outline" size="icon" className="size-7" onClick={() => step(l.product.id, -1)} aria-label={`Diminuir ${l.product.name}`}>
                        <Minus className="size-3.5" />
                      </Button>
                      <Input
                        value={l.qty}
                        onChange={(e) => setQty(l.product.id, e.target.value)}
                        inputMode="decimal"
                        aria-label={`Quantidade de ${l.product.name}`}
                        aria-invalid={over || q <= 0 || undefined}
                        className="h-7 w-16 text-center tabular-nums"
                      />
                      <Button variant="outline" size="icon" className="size-7" onClick={() => step(l.product.id, 1)} aria-label={`Aumentar ${l.product.name}`}>
                        <Plus className="size-3.5" />
                      </Button>
                      {over && <span className="ml-2 text-xs text-destructive">Máx. {formatQty(l.product.stock)}</span>}
                      <Button variant="ghost" size="icon" className="ml-auto size-7 text-muted-foreground" onClick={() => remove(l.product.id)} aria-label={`Remover ${l.product.name}`}>
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="space-y-4 border-t px-5 py-4">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="tabular-nums">{formatBRL(subtotal)}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt>
                <label htmlFor="pdv-discount" className="text-muted-foreground">
                  Desconto
                </label>
              </dt>
              <dd className="flex items-center gap-1">
                <div className="inline-flex rounded-md border p-0.5 text-xs" role="group" aria-label="Tipo de desconto">
                  {(["valor", "pct"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      aria-pressed={discountMode === m}
                      onClick={() => setDiscountMode(m)}
                      className={cn("rounded px-2 py-0.5", discountMode === m ? "bg-secondary font-medium" : "text-muted-foreground")}
                    >
                      {m === "valor" ? "R$" : "%"}
                    </button>
                  ))}
                </div>
                <Input
                  id="pdv-discount"
                  value={discountRaw}
                  onChange={(e) => setDiscountRaw(e.target.value)}
                  inputMode="decimal"
                  placeholder="0"
                  aria-invalid={discountInvalid || undefined}
                  className="h-8 w-24 text-right tabular-nums"
                />
              </dd>
            </div>
            {discountMode === "pct" && discount > 0 && (
              <p className="text-right text-xs text-muted-foreground tabular-nums">− {formatBRL(discount)}</p>
            )}
            {discountInvalid && <p className="text-right text-xs text-destructive">Desconto maior que o subtotal ou inválido</p>}
            <div className="flex items-baseline justify-between border-t pt-3">
              <dt className="font-medium">Total</dt>
              <dd className="text-2xl font-semibold tracking-tight tabular-nums">{formatBRL(Math.max(total, 0))}</dd>
            </div>
          </dl>

          <div className="space-y-1.5">
            <label htmlFor="pdv-customer" className="text-sm font-medium">
              Cliente <span className="font-normal text-muted-foreground">(opcional)</span>
            </label>
            <Input
              id="pdv-customer"
              list="pdv-customers"
              value={customerText}
              onChange={(e) => setCustomerText(e.target.value)}
              placeholder="Venda de balcão"
              autoComplete="off"
              maxLength={80}
              aria-describedby="pdv-customer-hint"
              aria-invalid={customerInvalid || undefined}
            />
            {newCustomer && (
              <Input
                value={customerPhone}
                onChange={(e) => setCustomerPhone(e.target.value)}
                inputMode="tel"
                placeholder="Telefone do novo cliente (opcional)"
                aria-label="Telefone do novo cliente"
                maxLength={20}
              />
            )}
            <p id="pdv-customer-hint" className="text-xs text-muted-foreground">
              {existingCustomer ? "Cliente cadastrado — a compra vai para o histórico dele" : newCustomer ? "Novo cliente: será cadastrado junto com a venda" : "Deixe em branco para venda sem identificação"}
            </p>
            <datalist id="pdv-customers">
              {customers.map((c) => (
                <option key={c.id} value={customerLabel(c)} />
              ))}
            </datalist>
          </div>

          <fieldset>
            <legend className="mb-2 text-sm font-medium">Pagamento</legend>
            <div className="grid grid-cols-3 gap-1.5">
              {(Object.entries(PAYMENT_METHODS) as [PaymentMethod, string][]).map(([k, label]) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={payment === k}
                  onClick={() => setPayment(k)}
                  className={cn(
                    "rounded-md border px-2 py-2 text-xs transition-colors hover:bg-accent",
                    payment === k && "border-primary bg-primary font-medium text-primary-foreground hover:bg-primary/90",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <Button className="h-11 w-full text-base" disabled={!canFinish} onClick={finish}>
            {pending && <Loader2 className="animate-spin" />}
            Finalizar venda
          </Button>
          {lines.length > 0 && payment === null && <p className="text-center text-xs text-muted-foreground">Escolha a forma de pagamento.</p>}
          <p className="text-center text-xs text-muted-foreground">
            <Link href="/vendas" className="underline-offset-4 hover:underline">
              Ver vendas do mês
            </Link>
          </p>
        </div>
      </section>
    </div>
  );
}

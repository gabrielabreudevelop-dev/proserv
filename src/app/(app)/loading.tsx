/** Esqueleto exibido enquanto a página do servidor carrega. */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-6" role="status" aria-label="Carregando">
      <div className="space-y-2">
        <div className="h-7 w-48 rounded-md bg-muted" />
        <div className="h-4 w-80 max-w-full rounded-md bg-muted" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-28 rounded-xl border bg-muted/40" />
        ))}
      </div>
      <div className="h-80 rounded-xl border bg-muted/40" />
      <span className="sr-only">Carregando…</span>
    </div>
  );
}

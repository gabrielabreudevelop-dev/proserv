import { formatBRL } from "@/lib/format";
import { weekdayShort } from "@/lib/time";

type Point = { date: string; value: number; count?: number };

/**
 * Barras diárias em SVG puro. Os últimos `highlightLast` dias ficam na cor de destaque;
 * os anteriores, apagados, servem de comparação. Inclui tabela oculta para leitores de tela.
 */
export function DailyBarChart({ data, highlightLast = 7, label, today, width = 700 }: { data: Point[]; highlightLast?: number; label: string; today: string; width?: number }) {
  const W = width;
  const H = 210;
  const padTop = 20;
  const padBottom = 38;
  const max = Math.max(...data.map((d) => d.value), 1);
  const slot = W / data.length;
  const barW = Math.min(30, slot * 0.62);
  const ticks = [0, max / 2, max];

  return (
    <figure className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
        {ticks.map((t) => {
          const y = padTop + (1 - t / max) * (H - padTop - padBottom);
          return <line key={t} x1={0} x2={W} y1={y} y2={y} stroke="var(--color-border)" strokeDasharray={t === 0 ? undefined : "3 4"} />;
        })}
        {data.map((d, i) => {
          const h = (d.value / max) * (H - padTop - padBottom);
          const x = i * slot + (slot - barW) / 2;
          const y = H - padBottom - h;
          const recent = i >= data.length - highlightLast;
          const isToday = d.date === today;
          return (
            <g key={d.date}>
              <title>{`${weekdayShort(d.date)} ${d.date.slice(8)}/${d.date.slice(5, 7)}: ${formatBRL(d.value)}${d.count !== undefined ? ` · ${d.count} venda(s)` : ""}`}</title>
              <rect x={i * slot} y={padTop} width={slot} height={H - padTop - padBottom} fill="transparent" />
              {d.value > 0 && <rect x={x} y={y} width={barW} height={Math.max(h, 2)} rx={3} fill="var(--color-primary)" opacity={recent ? 0.9 : 0.28} />}
              {recent && d.value > 0 && h > 18 && (
                <text x={x + barW / 2} y={y - 5} textAnchor="middle" fontSize={11} fill="var(--color-muted-foreground)">
                  {Math.round(d.value)}
                </text>
              )}
              <text x={i * slot + slot / 2} y={H - padBottom + 16} textAnchor="middle" fontSize={12} fill={isToday ? "var(--color-foreground)" : "var(--color-muted-foreground)"} fontWeight={isToday ? 600 : 400}>
                {d.date.slice(8)}
              </text>
              <text x={i * slot + slot / 2} y={H - padBottom + 30} textAnchor="middle" fontSize={10.5} fill="var(--color-muted-foreground)">
                {weekdayShort(d.date)}
              </text>
            </g>
          );
        })}
      </svg>
      <table className="sr-only">
        <caption>{label}</caption>
        <tbody>
          {data.map((d) => (
            <tr key={d.date}>
              <th scope="row">{d.date}</th>
              <td>{formatBRL(d.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

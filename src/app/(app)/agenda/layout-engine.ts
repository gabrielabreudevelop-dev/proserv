/**
 * Posiciona blocos de atendimento numa coluna da grade.
 * Blocos que se sobrepõem dividem a largura em faixas (lanes), como em agendas de calendário.
 */
export type Placeable = { id: string; start: number; end: number }; // minutos desde 00:00
export type Placed = { id: string; lane: number; lanes: number };

export function placeBlocks(items: Placeable[]): Map<string, Placed> {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const result = new Map<string, Placed>();
  let cluster: { item: Placeable; lane: number }[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    const lanes = Math.max(1, ...cluster.map((c) => c.lane + 1));
    for (const c of cluster) result.set(c.item.id, { id: c.item.id, lane: c.lane, lanes });
    cluster = [];
  };

  for (const item of sorted) {
    if (item.start >= clusterEnd && cluster.length) {
      flush();
      clusterEnd = -Infinity;
    }
    // Primeira faixa livre (cujo último bloco já terminou).
    const laneEnds = new Map<number, number>();
    for (const c of cluster) laneEnds.set(c.lane, Math.max(laneEnds.get(c.lane) ?? -Infinity, c.item.end));
    let lane = 0;
    while ((laneEnds.get(lane) ?? -Infinity) > item.start) lane++;
    cluster.push({ item, lane });
    clusterEnd = Math.max(clusterEnd, item.end);
  }
  if (cluster.length) flush();
  return result;
}

/** Arredonda um minuto do dia para baixo no passo da grade. */
export function snap(minute: number, step: number) {
  return Math.floor(minute / step) * step;
}

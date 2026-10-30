/** Constantes de estoque seguras para o cliente (sem acesso ao banco). */
export const ADJUSTMENT_REASONS = {
  PERDA: "Perda ou avaria",
  VENCIMENTO: "Produto vencido",
  CONTAGEM: "Correção de contagem",
} as const;
export type AdjustmentReason = keyof typeof ADJUSTMENT_REASONS;

export const MOVEMENT_LABELS = {
  ENTRADA: "Entrada",
  SAIDA_VENDA: "Venda",
  AJUSTE: "Ajuste",
  DEVOLUCAO: "Devolução",
} as const;

/** Estoque no mínimo ou abaixo dele. Sem mínimo definido, só alerta quando zera. */
export function stockStatus(stockQty: number, minStock: number | null): "ok" | "baixo" | "zerado" {
  if (stockQty <= 0) return "zerado";
  if (minStock !== null && stockQty <= minStock) return "baixo";
  return "ok";
}

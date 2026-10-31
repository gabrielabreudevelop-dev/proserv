import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * Verificação de saúde para o provedor de hospedagem e monitoramento.
 * Público, sem dados sensíveis: só diz se o app e o banco respondem.
 */
export async function GET() {
  const started = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return Response.json({ status: "ok", db: "up", latencyMs: Date.now() - started }, { headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ status: "error", db: "down" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}

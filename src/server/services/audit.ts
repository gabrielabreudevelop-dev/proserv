/**
 * Auditoria: quem fez o quê e quando. O registro só cresce.
 *
 * - Operações que mexem em dinheiro ou estoque gravam DENTRO da mesma transação
 *   (passando `tx`): ou grava tudo, ou nada.
 * - Mudanças de configuração gravam logo após o sucesso (ver actions/result.ts).
 */
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

type Db = Prisma.TransactionClient | typeof prisma;
export type Changes = Record<string, [unknown, unknown]>;

export type AuditEntry = {
  actorId: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  summary: string;
  changes?: Changes | null;
};

export async function writeAudit(db: Db, entry: AuditEntry) {
  const actor = entry.actorId ? await db.user.findUnique({ where: { id: entry.actorId }, select: { name: true } }) : null;
  await db.auditLog.create({
    data: {
      actorId: entry.actorId,
      actorName: actor?.name ?? "Sistema",
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId ?? null,
      summary: entry.summary,
      changes: entry.changes && Object.keys(entry.changes).length ? (entry.changes as Prisma.InputJsonValue) : Prisma.DbNull,
    },
  });
}

/** Compara dois objetos rasos e devolve só o que mudou: { campo: [antes, depois] }. */
export function diff(before: Record<string, unknown>, after: Record<string, unknown>, labels: Record<string, string> = {}): Changes {
  const out: Changes = {};
  const norm = (v: unknown) => (v === undefined || v === "" ? null : v instanceof Prisma.Decimal ? v.toString() : v);
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    const a = norm(before[key]);
    const b = norm(after[key]);
    if (JSON.stringify(a) !== JSON.stringify(b)) out[labels[key] ?? key] = [a, b];
  }
  return out;
}

export const AUDIT_ENTITIES = {
  Sale: "Venda",
  Product: "Produto",
  StockMovement: "Estoque",
  LedgerEntry: "Financeiro",
  CustomFieldDefinition: "Campo personalizado",
  Service: "Serviço",
  Appointment: "Atendimento",
  Customer: "Cliente",
  User: "Usuário",
} as const;

export type AuditRow = {
  id: string;
  createdAt: string;
  actorName: string;
  action: string;
  entity: string;
  entityId: string | null;
  summary: string;
  changes: Changes | null;
};

export async function listAudit({ from, to, entity, actorId, q, page = 1, pageSize = 50 }: { from: Date; to: Date; entity?: string; actorId?: string; q?: string; page?: number; pageSize?: number }) {
  const where: Prisma.AuditLogWhereInput = {
    createdAt: { gte: from, lt: to },
    ...(entity ? { entity } : {}),
    ...(actorId ? { actorId } : {}),
    ...(q ? { summary: { contains: q, mode: "insensitive" } } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * pageSize, take: pageSize }),
    prisma.auditLog.count({ where }),
  ]);
  return {
    total,
    rows: rows.map<AuditRow>((r) => ({
      id: r.id,
      createdAt: r.createdAt.toISOString(),
      actorName: r.actorName,
      action: r.action,
      entity: r.entity,
      entityId: r.entityId,
      summary: r.summary,
      changes: (r.changes as Changes | null) ?? null,
    })),
  };
}

import "server-only";

import { z } from "zod";
import { getSession } from "@/lib/auth/guards";
import { can, type Action, type Resource } from "@/lib/auth/permissions";
import { DomainError } from "@/server/services/errors";
import { parseDecimalInput } from "@/lib/format";
import { writeAudit, type AuditEntry } from "@/server/services/audit";
import { prisma } from "@/lib/db";

export type ActionResult<T = undefined> =
  | { ok: true; data: T }
  | { ok: false; error: string; fieldErrors?: Record<string, string> };

type Session = NonNullable<Awaited<ReturnType<typeof getSession>>>;

/**
 * Envelope de toda Server Action: confere sessão e permissão, valida a entrada
 * com Zod e converte erros de negócio em resposta amigável. Nunca confia no menu.
 */
export async function guardedAction<R extends Resource, S extends z.ZodType, T>(
  permission: { resource: R; action: Action<R> },
  schema: S,
  rawInput: unknown,
  run: (input: z.output<S>, session: Session) => Promise<T>,
): Promise<ActionResult<T>> {
  const session = await getSession();
  if (!session) return { ok: false, error: "Sua sessão expirou. Entre novamente." };
  if (!can(session.user.role, permission.resource, permission.action)) {
    return { ok: false, error: "Seu cargo não permite esta ação." };
  }

  const parsed = schema.safeParse(rawInput);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path.join(".");
      if (key && !fieldErrors[key]) fieldErrors[key] = issue.message;
    }
    return { ok: false, error: "Revise os campos destacados.", fieldErrors };
  }

  try {
    return { ok: true, data: await run(parsed.data, session) };
  } catch (e) {
    if (e instanceof DomainError) return { ok: false, error: e.message, fieldErrors: e.fieldErrors };
    console.error(e);
    return { ok: false, error: "Algo deu errado. Tente de novo em instantes." };
  }
}

/**
 * Auditoria de mudanças de configuração, gravada logo após o sucesso da ação.
 * (Operações com dinheiro/estoque auditam dentro da própria transação, nos serviços.)
 * Uma falha aqui nunca desfaz a ação já concluída — é registrada no log do servidor.
 */
export async function auditAfter(session: Session, entry: Omit<AuditEntry, "actorId">) {
  try {
    await writeAudit(prisma, { ...entry, actorId: session.user.id });
  } catch (e) {
    console.error("[auditoria] falha ao registrar", entry.action, e);
  }
}

/** Decimal digitado em pt-BR ("3,50") → string canônica ("3.50"). */
export const decimalField = (label: string, { min = 0, allowNegative = false } = {}) =>
  z.union([z.string(), z.number()]).transform((v, ctx) => {
    const parsed = parseDecimalInput(v);
    if (parsed === null) {
      ctx.addIssue({ code: "custom", message: `Valor inválido para ${label}` });
      return z.NEVER;
    }
    if (!allowNegative && Number(parsed) < min) {
      ctx.addIssue({ code: "custom", message: min > 0 ? `Deve ser maior que ${min}` : "Não pode ser negativo" });
      return z.NEVER;
    }
    return parsed;
  });

export const optionalDecimal = (label: string) =>
  z.preprocess((v) => (v === "" || v === null ? undefined : v), decimalField(label).optional());

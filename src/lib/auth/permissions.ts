/**
 * Mapa único de permissões do ProServ.
 *
 * - É usado pelo plugin `admin` do Better Auth (via `ac` e `roles`).
 * - É usado pelo servidor (`can()` / guards) e para montar o menu lateral,
 *   para que UI e backend nunca divirjam.
 */
import { createAccessControl } from "better-auth/plugins/access";
import { adminAc, defaultStatements } from "better-auth/plugins/admin/access";

export const statement = {
  ...defaultStatements, // user/session: ações internas do plugin admin
  dashboardProdutos: ["ver", "verTodos"],
  dashboardServicos: ["ver", "verTodos"],
  produto: ["ver", "criar", "editar", "estoque"],
  campo: ["gerenciar"],
  venda: ["registrar", "cancelar", "verTodas"],
  servico: ["ver", "gerenciar"],
  agenda: ["ver", "verTodas", "agendar", "concluir"],
  financeiro: ["ver", "lancar"],
} as const;

export const ac = createAccessControl(statement);

const all = {
  dashboardProdutos: ["ver", "verTodos"],
  dashboardServicos: ["ver", "verTodos"],
  produto: ["ver", "criar", "editar", "estoque"],
  campo: ["gerenciar"],
  venda: ["registrar", "cancelar", "verTodas"],
  servico: ["ver", "gerenciar"],
  agenda: ["ver", "verTodas", "agendar", "concluir"],
  financeiro: ["ver", "lancar"],
} as const;

export const roles = {
  /** Dono do negócio: tudo, inclusive usuários e cargos. */
  admin: ac.newRole({ ...all, ...adminAc.statements }),

  /** Gerente: opera todo o negócio, mas não gerencia usuários. */
  gerente: ac.newRole({ ...all }),

  /** Vendedor: produtos (leitura) e vendas; dashboard só com suas vendas. */
  vendedor: ac.newRole({
    dashboardProdutos: ["ver"],
    produto: ["ver"],
    venda: ["registrar"],
  }),

  /** Prestador: apenas a própria agenda e o catálogo de serviços. */
  prestador: ac.newRole({
    dashboardServicos: ["ver"],
    servico: ["ver"],
    agenda: ["ver", "concluir"],
  }),
};

export type RoleName = keyof typeof roles;
export const ROLE_NAMES = Object.keys(roles) as RoleName[];

export const ROLE_LABELS: Record<RoleName, string> = {
  admin: "Administrador",
  gerente: "Gerente",
  vendedor: "Vendedor",
  prestador: "Prestador",
};

type Statement = typeof statement;
export type Resource = Exclude<keyof Statement, "user" | "session">;
export type Action<R extends Resource> = Statement[R][number];

/** O plugin admin guarda múltiplos cargos como "admin,gerente". */
export function parseRoles(role: string | null | undefined): RoleName[] {
  if (!role) return [];
  return role
    .split(",")
    .map((r) => r.trim())
    .filter((r): r is RoleName => r in roles);
}

/**
 * Verifica se um cargo (ou lista de cargos) pode executar `action` em `resource`.
 * Função pura: roda no servidor sem ida ao banco.
 */
export function can<R extends Resource>(
  role: string | null | undefined,
  resource: R,
  action: Action<R>,
): boolean {
  return parseRoles(role).some(
    (name) =>
      roles[name].authorize({ [resource]: [action] } as Parameters<
        (typeof roles)[RoleName]["authorize"]
      >[0]).success,
  );
}

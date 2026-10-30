# ProServ

Sistema de gestão de produtos, serviços, vendas e finanças (Lucro/Prejuízo), desktop-first.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui · TanStack Table v8 · Prisma ORM 7 · PostgreSQL · Better Auth.

## Rodando localmente

Pré-requisitos: Node 22+ e PostgreSQL 16+.

```bash
cp .env.example .env          # ajuste DATABASE_URL e BETTER_AUTH_SECRET
npm install
npx prisma generate
npx prisma migrate dev        # cria as tabelas
npx prisma db seed            # usuários de exemplo + 24 produtos

# banco de testes (uma vez)
createdb proserv_test
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/proserv_test npx prisma migrate deploy
npm run dev
```

Acesse http://localhost:3000 e entre com um dos usuários do seed (senha `proserv123`):

| Cargo | E-mail | Vê |
| --- | --- | --- |
| Administrador | admin@proserv.local | tudo, inclusive usuários |
| Gerente | gerente@proserv.local | tudo, exceto usuários |
| Vendedor | vendedor@proserv.local | dashboard de produtos, produtos (leitura), vendas |
| Prestador | prestador@proserv.local | dashboard de serviços, serviços, agenda |

## Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | servidor de desenvolvimento |
| `npm run build` | build de produção |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | testes unitários e de integração (Vitest; usa o banco `proserv_test`) |
| `npx prisma studio` | inspecionar o banco |

## Controle de acesso

As permissões vivem em um único arquivo, `src/lib/auth/permissions.ts`, usado pelo Better Auth, pelo servidor e pelo menu. A validação acontece em camadas:

1. `src/proxy.ts` — só exige cookie de sessão (sem banco).
2. Layouts e páginas — `requireSession()` / `requirePermission()`.
3. Server Actions e Route Handlers — `requirePermission()` / `authorizeRequest()` antes de qualquer escrita.
4. Consultas — filtro por dono do registro quando o cargo é restrito.

## Produtos (Fase 1)

- **Campos personalizados** (`/produtos/campos`): criar um campo é um `INSERT` em `CustomFieldDefinition`; os valores ficam em `Product.customFields` (JSONB). Sem migração. Tipos: texto, número, data, sim/não e lista. O tipo não muda depois de criado; arquivar esconde o campo e preserva os valores.
- **Tabela**: uma coluna por campo ativo, na ordem definida em `/produtos/campos`. Cada pessoa oculta colunas e escolhe itens por página; a escolha fica salva em `TablePreference`.
- **Estoque**: entrada recalcula o custo médio ponderado (4 casas). Ajuste negativo baixa ao custo médio e lança `DESPESA` no livro-razão. Estoque nunca fica negativo; a linha do produto é travada (`FOR UPDATE`) durante a operação.
- **Custo e margem** só saem do servidor para quem pode ver o financeiro (admin e gerente).

## Estrutura

```text
src/
  app/(auth)/login/        tela de login
  app/(app)/               área logada (layout com sidebar)
  app/api/auth/[...all]/   handler do Better Auth
  components/app-shell/    sidebar, menu do usuário, seletor Produtos/Serviços
  components/ui/           shadcn/ui
  lib/auth/                auth, cliente, permissões e guards
  lib/custom-fields.ts     regras puras dos campos personalizados (Zod)
  server/services/         regras de negócio com banco (produtos, estoque, campos)
  server/actions/          Server Actions: permissão + validação + serviço
  lib/db.ts                Prisma Client (adapter pg)
  generated/prisma/        cliente gerado (não versionado)
prisma/schema.prisma       modelo de dados
prisma.config.ts           configuração do Prisma CLI
```

## Roadmap

- [x] Fase 0 — Fundação: repositório, CI, Prisma, autenticação, cargos, layout
- [x] Fase 1 — Produtos: CRUD, campos personalizados, tabela dinâmica, estoque
- [ ] Fase 2 — Vendas e financeiro: PDV, livro-razão, CMV, DRE
- [ ] Fase 3 — Serviços e dashboard
- [ ] Fase 4 — Lançamento: E2E, auditoria, deploy

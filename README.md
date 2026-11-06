# ProServ

Sistema de gestão de produtos, serviços, vendas e finanças (Lucro/Prejuízo), desktop-first.

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind CSS 4 · shadcn/ui · TanStack Table v8 · Prisma ORM 7 · PostgreSQL · Better Auth.

**Repositório oficial:** [gabrielabreudevelop-dev/proserv](https://github.com/gabrielabreudevelop-dev/proserv)

## Rodando localmente

Pré-requisitos: Node 22+ e PostgreSQL 16+.

```bash
cp .env.example .env          # ajuste DATABASE_URL e BETTER_AUTH_SECRET
npm install
npx prisma generate
npx prisma migrate dev        # cria as tabelas
npx prisma db seed            # usuários, 24 produtos, vendas e despesas de exemplo

# bancos de teste (uma vez)
createdb proserv_test && createdb proserv_e2e
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/proserv_test npx prisma migrate deploy
npm run dev
```

Acesse http://localhost:3000 e entre com um dos usuários do seed (senha `proserv123`):

| Cargo | E-mail | Vê |
| --- | --- | --- |
| Administrador | admin@proserv.local | tudo, inclusive usuários |
| Gerente | gerente@proserv.local | tudo, exceto usuários |
| Vendedor | vendedor@proserv.local | dashboard de produtos, produtos (leitura), vendas |
| Prestador | prestador@proserv.local · prestador2@proserv.local | dashboard de serviços, catálogo, a própria agenda |

## Scripts

| Comando | O que faz |
| --- | --- |
| `npm run dev` | servidor de desenvolvimento |
| `npm run build` | build de produção |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | testes unitários e de integração (Vitest; usa o banco `proserv_test`) |
| `npm run test:e2e` | testes de navegador (Playwright; recria o banco `proserv_e2e`; rode `npm run build` antes) |
| `npm run create-admin -- --email … --name "…"` | cria o primeiro administrador (ou `--reset` para recuperar o acesso) |
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

## Vendas e financeiro (Fase 2)

- **PDV** (`/vendas/nova`): busca por teclado (↑ ↓ Enter), carrinho, desconto em R$ ou %, forma de pagamento, `Ctrl+Enter` finaliza. O preço vem sempre do cadastro, nunca do navegador.
- **Venda atômica**: numa única transação grava a venda, baixa o estoque, congela o custo médio de cada item e lança `RECEITA_PRODUTO` (líquida do desconto) e `CMV`. Produtos são travados em ordem fixa, então vendas simultâneas nunca vendem além do estoque.
- **Cancelamento** (gerente/admin): devolve o estoque pelo custo congelado e lança estornos na data do cancelamento. Cada estorno aponta para o lançamento original (`reversesId` único), então nada é estornado duas vezes.
- **Financeiro** (`/financeiro`): DRE do mês no fuso de Brasília, despesas por categoria, extrato do livro-razão, lançar e estornar despesa. Lucro/Prejuízo nunca é guardado: é sempre a soma dos lançamentos.
- **Conferência**: `docs/conferencia-financeira.md` traz um mês calculado à mão; `src/server/services/finance.test.ts` exige que a DRE bata centavo a centavo.
- Vendedor vê só as próprias vendas e nunca recebe custo ou lucro do servidor.

## Serviços, agenda e dashboard (Fase 3)

- **Serviços** (`/servicos`): duração, valor e custo estimado (insumos/comissão). A duração define o tamanho do horário na agenda.
- **Agenda** (`/agenda`): visão dia (uma coluna por prestador) e semana, linha do "agora", atrasados em destaque. Clicar num horário vago agenda; o diálogo avisa choque de horário antes de enviar.
- **Sem choque de horário**: o agendamento trava o prestador (`pg_advisory_xact_lock`) e só então confere sobreposição. Agendamentos simultâneos no mesmo horário: só um entra.
- **Ciclo**: agendado → em andamento → concluído (ou cancelado). Iniciar/concluir liberam 1 h antes do horário. Concluir lança `RECEITA_SERVICO` (valor cobrado) e `DESPESA` com o custo estimado, na data do atendimento. Cancelar um concluído (gerente/admin) estorna os dois.
- **Prestador** vê e conclui só os próprios atendimentos — o filtro é aplicado na consulta, e a URL `?prestador=` é ignorada para ele.
- **Dashboard**: visão Produtos (faturamento e vendas de 7 dias com comparação, mais vendidos, estoque baixo, lucro do mês) e visão Serviços (faturamento do dia e da semana, agenda de hoje, pendentes, taxa de conclusão). Cada um escolhe a visão padrão. Vendedor e prestador veem só os próprios números, e o prestador não vê valores.

## Administração e qualidade (Fase 4)

- **Usuários** (`/config/usuarios`, só admin): criar com senha provisória, combinar cargos, bloquear (encerra as sessões na hora), gerar nova senha. Ninguém remove o próprio cargo de admin nem bloqueia a si mesmo, e o sistema nunca fica sem administrador ativo. Cada pessoa troca a própria senha em **Minha conta**.
- **Auditoria** (`/config/auditoria`, só admin): quem fez o quê e quando, com antes → depois nas edições. Vendas, cancelamentos, estoque, despesas e atendimentos gravam a auditoria na mesma transação; configurações gravam logo após o sucesso. O registro só cresce.
- **Celular**: menu lateral vira botão de menu abaixo de 768 px.
- **Testes de navegador**: `e2e/` com Playwright Test (55 testes, uma pasta por fase), rodando no CI a cada push contra o build de produção.
- **Produção preparada, não publicada**: cabeçalhos de segurança (CSP, HSTS), `/api/health`, `Dockerfile`, Dependabot e guia em [docs/deploy.md](docs/deploy.md).

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
e2e/                       testes de navegador (Playwright)
scripts/create-admin.ts    primeiro administrador em produção
docs/                      conferência financeira, deploy e pendências
prisma/schema.prisma       modelo de dados
prisma.config.ts           configuração do Prisma CLI
```

## Roadmap

- [x] Fase 0 — Fundação: repositório, CI, Prisma, autenticação, cargos, layout
- [x] Fase 1 — Produtos: CRUD, campos personalizados, tabela dinâmica, estoque
- [x] Fase 2 — Vendas e financeiro: PDV, livro-razão, CMV, DRE
- [x] Fase 3 — Serviços, agenda e dashboard
- [x] Fase 4 — Auditoria, usuários, celular, testes de navegador no CI, produção preparada
- [ ] Publicação — em aberto até resolver as [pendências](docs/pendencias.md)

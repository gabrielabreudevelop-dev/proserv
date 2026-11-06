# Publicação em produção

> **Status: preparado, não publicado.** A publicação fica em aberto até as pendências
> de todas as fases estarem resolvidas — ver [pendencias.md](./pendencias.md).

Duas opções testadas na arquitetura. A recomendada é a **A**.

## A. Vercel + Postgres gerenciado (recomendado)

Menos operação: HTTPS, domínio, prévias por pull request e escala automática.

1. **Banco** — criar um Postgres 16+ gerenciado (Neon, Supabase ou Vercel Postgres) na
   região São Paulo (`sa-east-1`) ou a mais próxima. Ativar backup com recuperação
   point-in-time. Anotar duas URLs: a *pooled* (app) e a *direta* (migrações).
2. **Projeto na Vercel** — importar o repositório `gabrielabreudevelop-dev/proserv`.
   - Framework: Next.js. Região das funções: `gru1` (São Paulo).
   - Build command: `prisma generate && next build` (padrão do `npm run build` já roda `postinstall`).
3. **Variáveis de ambiente** (Production e Preview separadas):

   | Variável | Valor |
   | --- | --- |
   | `DATABASE_URL` | URL *pooled* do banco, com `sslmode=require` |
   | `BETTER_AUTH_SECRET` | `openssl rand -base64 32` — nunca reutilizar o de desenvolvimento |
   | `BETTER_AUTH_URL` | `https://<domínio de produção>` |

4. **Migrações** — rodar antes do primeiro deploy e a cada mudança de schema, com a URL direta:
   `DATABASE_URL=<url direta> npx prisma migrate deploy`. Recomendado: um job no
   GitHub Actions na `main` que roda isso antes do deploy de produção.
5. **Primeiro administrador** — não há cadastro público:
   `DATABASE_URL=<url direta> npm run create-admin -- --email dono@empresa.com.br --name "Nome"`.
   A senha provisória aparece uma vez; troque em **Minha conta**.
6. **Não rodar o seed em produção** (o script se recusa com `NODE_ENV=production`).

## B. Docker em servidor próprio (VPS)

```bash
docker build -t proserv .
docker run --rm --env-file .env.production proserv npx prisma migrate deploy
docker run --rm --env-file .env.production proserv node -e "" # sanity check
docker run -d --name proserv --restart unless-stopped -p 127.0.0.1:3000:3000 --env-file .env.production proserv
```

Colocar um proxy reverso com HTTPS na frente (Caddy ou Nginx + Let's Encrypt). O
contêiner expõe `HEALTHCHECK` em `/api/health`. Backups: `pg_dump` diário com retenção
de 30 dias, guardado fora do servidor, e um teste de restauração por mês.

## Depois de publicar (checklist de fumaça)

- [ ] `GET /api/health` responde `{"status":"ok","db":"up"}`
- [ ] Login do administrador e troca da senha provisória
- [ ] Criar um usuário de cada cargo e conferir os menus
- [ ] Cadastrar um produto com entrada de estoque, fazer uma venda e cancelar
- [ ] Conferir a venda e o estorno no Financeiro e na Auditoria
- [ ] Agendar e concluir um atendimento; conferir o dashboard de serviços
- [ ] Cabeçalhos de segurança presentes (CSP, HSTS) — ex.: securityheaders.com
- [ ] Monitor externo chamando `/api/health` a cada 5 minutos

## Segurança já embutida

- Sessões do Better Auth com cookies `HttpOnly`/`Secure`; limite de 3 tentativas de login a cada 10 s
- Permissão conferida no servidor em toda página, ação e consulta; o menu só reflete isso
- CSP sem terceiros, `X-Frame-Options: DENY`, HSTS em produção
- Operações de dinheiro e estoque atômicas e auditadas; registro de auditoria só cresce
- Atualizações de segurança do Next.js saem mensalmente: manter o Dependabot ativo e aplicar em até 7 dias

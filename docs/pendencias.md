# Pendências antes da publicação

A publicação em produção fica **em aberto até todos os itens bloqueantes abaixo estarem
marcados**. O passo a passo da publicação está em [deploy.md](./deploy.md).

## Bloqueiam a publicação

### Repositório e CI
- [ ] Vincular o GitHub ao Claude (claude.ai → Settings → Connectors) e instalar o
      Claude GitHub App no repositório `gabriellopesabreu/proserv` — *desde a Fase 0*
- [ ] Enviar os commits para o GitHub (push da branch `main`)
- [ ] Primeira execução do CI **no GitHub** verde (lint, tipos, 77 testes, build e 55 testes
      de navegador). Localmente tudo passa; no GitHub ainda não rodou nenhuma vez.

### Decisões de negócio a confirmar (de preferência com o contador)
- [ ] Regime de competência: comprar mercadoria não reduz o lucro; o custo entra quando o
      produto é vendido (CMV) — *Fase 2*
- [ ] Cancelamento de venda entra no mês do cancelamento, não no mês da venda — *Fase 2*
- [ ] Receita registrada já com o desconto — *Fase 2*
- [ ] Custo estimado do serviço (insumos/comissão) lançado como despesa a cada conclusão — *Fase 3*
- [ ] Vendedor não vê custo nem margem — *Fase 1*
- [ ] Prestador conclui os próprios atendimentos, mas não agenda — *Fase 3*
- [ ] Iniciar/concluir atendimento liberados 1 hora antes do horário — *Fase 3*

### Aceite
- [ ] Aceite da agenda e do dashboard (critério de saída da Fase 3)
- [ ] Aceite da gestão de usuários, auditoria e menu no celular (Fase 4)

### Hospedagem
- [ ] Escolher a opção: **A. Vercel + Postgres gerenciado** (recomendada) ou B. Docker em VPS
- [ ] Domínio e e-mail do administrador inicial
- [ ] Banco de produção criado na região de São Paulo, com backup point-in-time
- [ ] Segredos de produção gerados (`BETTER_AUTH_SECRET` novo, nunca o de desenvolvimento)
- [ ] Se for a opção B: construir e testar a imagem Docker — o `Dockerfile` está pronto e o
      servidor autocontido foi testado, mas a imagem não pôde ser construída no ambiente de
      desenvolvimento (Docker Hub bloqueado pela rede)

## Recomendados (não bloqueiam)

- [ ] Recuperação de senha por e-mail. Hoje o administrador gera uma senha provisória;
      por e-mail exige um serviço de envio (Resend, SES ou SMTP)
- [ ] Aviso de privacidade (LGPD) para os dados de clientes (nome e telefone) e prazo de retenção
- [ ] Monitor externo chamando `/api/health` a cada 5 minutos
- [ ] Teste mensal de restauração de backup
- [ ] Tela de clientes (hoje são cadastrados e escolhidos pela agenda)
- [ ] Migrar a tabela de produtos para o TanStack Table v9 quando o shadcn atualizar o exemplo

## Fora do escopo do MVP

NF-e/NFS-e (retirada do plano) · integração com meios de pagamento · multiempresa ·
importação por planilha · app mobile dedicado.

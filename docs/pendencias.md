# Pendências antes da publicação

A publicação em produção fica **em aberto até todos os itens bloqueantes abaixo estarem
marcados**. O passo a passo da publicação está em [deploy.md](./deploy.md).

## Bloqueiam a publicação

### Repositório e CI
- [ ] Vincular o GitHub ao Claude (claude.ai → Settings → Connectors) e instalar o
      Claude GitHub App no repositório `gabrielabreudevelop-dev/proserv` — *desde a Fase 0*
- [ ] Enviar os commits para o GitHub (push da branch `main`)
- [ ] Primeira execução do CI **no GitHub** verde (lint, tipos, 100 testes, build e 75 testes
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
- [ ] Tela de clientes só para gerente e admin; vendedor escolhe ou cadastra cliente no caixa
      (vê nome e telefone na busca) e o prestador vê só o cliente de cada atendimento — *Clientes*
- [ ] "Sumido" = mais de 60 dias sem atendimento nem compra e nada agendado — *Clientes*
- [ ] Excluir dados pessoais a pedido também apaga o nome das frases da auditoria — *Clientes*
- [ ] Retornos: tela só para gerente e admin; o prestador ajusta ou dispensa o retorno ao concluir — *Retornos*
- [ ] Regras de retorno iniciais (instalação → manutenção em 6 meses, limpeza a cada 3, manutenção a cada 6)
      são exemplos: conferir com a prática da empresa — *Retornos*

### Aceite
- [ ] Aceite da agenda e do dashboard (critério de saída da Fase 3)
- [ ] Aceite da gestão de usuários, auditoria e menu no celular (Fase 4)
- [ ] Aceite da tela de clientes e do cliente na venda
- [ ] Aceite dos retornos (regra no serviço, conclusão, tela de contatos, dashboard)

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
- [ ] Aviso de privacidade (LGPD) para os dados de clientes (nome e telefone) e prazo de retenção.
      A exclusão a pedido do cliente já existe na ficha.
- [ ] Monitor externo chamando `/api/health` a cada 5 minutos
- [ ] Teste mensal de restauração de backup
- [x] Tela de clientes, com histórico, juntar cadastros e exclusão de dados (LGPD)
- [ ] Envio automático de lembretes de retorno pelo WhatsApp (exige a API oficial do WhatsApp
      Business, paga e com aprovação da Meta). Hoje a mensagem sai pronta e o envio é manual
- [ ] Migrar a tabela de produtos para o TanStack Table v9 quando o shadcn atualizar o exemplo

## Fora do escopo do MVP

NF-e/NFS-e (retirada do plano) · integração com meios de pagamento · multiempresa ·
importação por planilha · app mobile dedicado.

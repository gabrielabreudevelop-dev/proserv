# Roteiros E2E (navegador)

Checagens ponta a ponta usadas como critério de saída de cada fase. Rodam contra o
servidor de produção local (`npm run build && npm start`) e o banco de desenvolvimento
populado pelo seed.

```bash
node scripts/e2e/e2e-fase3.mjs ./screenshots
```

Requisitos atuais: Playwright instalado globalmente e acesso ao `psql` como usuário
`postgres` (os roteiros conferem números direto no banco). Cada roteiro cria dados com
um sufixo aleatório; limpe-os depois se quiser o banco de demonstração intacto.

Na Fase 4 eles viram testes do Playwright Test, com banco próprio e execução no CI.

| Roteiro | Checagens | O que cobre |
| --- | --- | --- |
| e2e-fase0 | 28 | login dos cargos, menus, bloqueios, limite de tentativas |
| e2e-fase1 | 30 | campos sem migração, tabela, estoque, custo médio, visão do vendedor |
| e2e-fase2 | 27 | PDV, cancelamento, DRE batendo com a planilha, visão do vendedor |
| e2e-fase3 | 32 | serviços, agenda, choque de horário, conclusão, dashboard × banco, prestador |

# Conferência financeira — critério de saída da Fase 2

Cenário de um mês (março de 2025) calculado **à mão**, sem o sistema. O teste
`src/server/services/finance.test.ts` executa exatamente estas operações pelo
código de produção e exige que a DRE bata centavo a centavo com a coluna "Esperado".

Horários em Brasília (UTC−3).

## Produtos

| Produto | Preço de venda |
| --- | --- |
| A | R$ 10,00 |
| B | R$ 50,00 |

## Operações

| # | Data | Operação | Cálculo à mão | Efeito |
| --- | --- | --- | --- | --- |
| 1 | 03/03 | Entrada A: 10 un. a R$ 4,00 | — | estoque A = 10, custo médio A = 4,00 |
| 2 | 03/03 | Entrada A: 10 un. a R$ 6,00 | (10×4 + 10×6) / 20 = **5,00** | estoque A = 20, custo médio A = 5,00 |
| 3 | 03/03 | Entrada B: 5 un. a R$ 20,00 | — | estoque B = 5, custo médio B = 20,00 |
| 4 | 05/03 | Venda 1: 3 A + 1 B, desconto R$ 5,00, Pix | subtotal 3×10 + 1×50 = 80; total 80 − 5 = **75**; CMV 3×5 + 1×20 = **35** | receita +75, CMV −35 |
| 5 | 10/03 | Venda 2: 2 A, dinheiro | total 2×10 = **20**; CMV 2×5 = **10** | receita +20, CMV −10 |
| 6 | 12/03 | Venda 3: 2 B, crédito | total 2×50 = **100**; CMV 2×20 = **40** | receita +100, CMV −40 |
| 7 | 13/03 | Cancela a venda 3 | estorno de receita **−100**; estorno de CMV **+40** | B volta ao estoque |
| 8 | 15/03 | Perda de 1 A | 1 × 5,00 = **5,00** | despesa −5,00 |
| 9 | 20/03 | Despesa: aluguel | **30,00** | despesa −30,00 |
| 10 | 25/03 | Despesa: energia | **12,50** | despesa −12,50 |
| 11 | 26/03 | Despesa: internet, depois estornada (lançada por engano) | 9,90 − 9,90 = **0** | líquido zero |
| 12 | 31/03 23:30 | Venda 4: 1 A | total **10**; CMV **5** | conta em **março** (já é 01/04 em UTC) |
| 13 | 01/04 00:30 | Venda 5: 1 A | total 10; CMV 5 | conta em **abril**, fora de março |

## DRE de março — esperado

| Linha | Cálculo | Esperado |
| --- | --- | --- |
| Receita de produtos | 75 + 20 + 100 + 10 | **205,00** |
| (−) Cancelamentos | −100 | **−100,00** |
| = Receita líquida | 205 − 100 | **105,00** |
| (−) CMV | 35 + 10 + 40 + 5 − 40 | **50,00** |
| = Lucro bruto | 105 − 50 | **55,00** |
| (−) Despesas | 5 + 30 + 12,50 + 9,90 − 9,90 | **47,50** |
| = **Resultado (lucro)** | 55 − 47,50 | **7,50** |
| Margem bruta | 55 / 105 | **52,38%** |
| Vendas concluídas | vendas 1, 2 e 4 | **3** |

Despesas por categoria: Aluguel 30,00 · Energia 12,50 · Perda de estoque 5,00 (Internet some, pois o estorno zera).

## Abril — esperado

Receita 10,00 · CMV 5,00 · Resultado **5,00**.

## Estoque final — esperado

| Produto | Cálculo | Esperado |
| --- | --- | --- |
| A | 20 − 3 − 2 − 1 (perda) − 1 − 1 | **12** |
| B | 5 − 1 − 2 + 2 (cancelamento) | **4** |

## Regras que o cenário exercita

- Receita é registrada **líquida do desconto**.
- CMV usa o **custo médio do momento da venda**, congelado no item.
- Cancelamento gera **estornos na data do cancelamento** e devolve o estoque pelo custo congelado.
- Entrada de estoque **não** afeta o resultado (regime de competência).
- Perda de estoque é despesa pelo custo médio.
- O mês é fechado no **fuso de Brasília**, não em UTC.

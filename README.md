# Shopify Preorder

App Shopify para pré-vendas da TopFuel Garage.

## Regra fechada

- A **tag controla somente a quantidade** máxima de pré-venda por produto.
- A **previsão é individual por produto**.
- Produtos diferentes podem usar a mesma tag e ter previsões diferentes.
- O pagamento da entrada usa um **checkout normal da Shopify**, sem `selling_plan`, para manter o fluxo compatível com gateways comuns como Mercado Pago/PIX.

Exemplo:

```text
Tag: Prevenda2
Quantidade: 3

Honda Civic  -> Prevenda2 -> 3 unidades -> previsão JAN/2027
Nissan R33   -> Prevenda2 -> 3 unidades -> previsão MAR/2027
```

## O que o MVP já faz

- painel embedded no Admin Shopify;
- cadastro de regras `tag -> quantidade`;
- lista os produtos que possuem uma das tags configuradas;
- previsão individual por produto;
- percentual de entrada individual por produto;
- cria um produto interno de reserva com o valor da entrada;
- controla a quantidade da pré-venda usando inventário Shopify do produto interno;
- grava metafields no produto original;
- Theme App Extension com os selos `PRÉ-VENDA` e `PREVISÃO DE ENVIO`;
- mostra valor total, entrada, saldo e quantidade restante;
- botão `RESERVAR POR ...` adiciona a reserva ao carrinho normal;
- webhook `orders/paid` registra a reserva e calcula o saldo;
- cancelamento/reembolso atualiza o status da reserva;
- botão `Produto chegou · liberar saldos`;
- geração de Draft Order para cobrança do saldo;
- frete opcional informado antes da cobrança;
- envio de invoice por e-mail com checkout seguro da Shopify;
- webhook detecta o pagamento do saldo e marca a reserva como paga;
- CI com `prisma generate`, TypeScript e build React Router.

## Stack

- Shopify React Router app
- TypeScript
- Prisma
- PostgreSQL
- Shopify Admin GraphQL API `2026-07`
- Theme App Extension

## Desenvolvimento

Requisitos:

- Node.js 22
- PostgreSQL
- Shopify CLI
- uma loja de desenvolvimento/teste Shopify

```bash
git clone https://github.com/Silvioerick/shopify-preorder.git
cd shopify-preorder
npm install
cp .env.example .env
```

Crie o banco PostgreSQL e ajuste `DATABASE_URL`.

Depois vincule o projeto ao app Shopify:

```bash
shopify app config link
```

A CLI preencherá/ajustará o `client_id` e as URLs de desenvolvimento.

Execute:

```bash
npx prisma migrate deploy
npm run dev
```

## Primeiro teste

1. Instale o app na loja de teste.
2. No painel do app, crie a regra `Prevenda2` com quantidade `3`.
3. Coloque a tag `Prevenda2` em um produto sem estoque.
4. Volte ao painel do app.
5. Informe uma previsão, por exemplo `FEV/2027`, e entrada `20%`.
6. Clique em `Ativar pré-venda`.
7. No editor de tema Shopify, adicione o bloco **Pré-venda TopFuel** ao template de produto.
8. Abra o produto e confirme os dois selos, valores e botão de reserva.
9. Faça um pedido de teste da entrada.
10. Confirme que a reserva aparece no painel do app.
11. Clique em `Produto chegou · liberar saldos`.
12. Informe o frete e clique em `Cobrar`.
13. O cliente recebe o e-mail de invoice e pode concluir o saldo no checkout Shopify.

## Observações do MVP

- Neste primeiro corte o app trabalha com a **primeira variante** do produto. Para as miniaturas da TopFuel, que normalmente são produtos de variante única, isso atende o fluxo inicial.
- O painel busca os 100 produtos atualizados mais recentemente. Paginação será adicionada antes de transformar o projeto em app comercial para múltiplas lojas.
- Produtos internos de reserva recebem a tag `__preorder_deposit` e `seo.hidden = 1`.
- Não coloque chaves da Shopify ou senha do PostgreSQL no repositório.

## Status

MVP funcional compilando no GitHub Actions. Próximo passo: vincular a uma loja Shopify de teste e validar as mutações GraphQL e o checkout real com Mercado Pago/PIX.

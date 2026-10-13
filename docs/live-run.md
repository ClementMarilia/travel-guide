# Rodada com chave real

Os testes automáticos usam um Gemini simulado. Esta rodada serve para ver o que eles não mostram: se os links da busca resolvem para páginas reais, se o modelo segue o formato de fatos, se as unidades de preço saem certas e se a busca está na sua cota.

## O que é preciso

1. **Chave do Gemini** criada no Google AI Studio, guardada como a variável de ambiente `GEMINI_API_KEY` (nunca no chat, nem no repositório).
2. **Um Postgres descartável** com as migrações aplicadas (`DATABASE_URL`).
3. **Acesso de rede** a:
   - `generativelanguage.googleapis.com` (a API);
   - `vertexaisearch.cloud.google.com` (os links de redirecionamento devolvidos pela busca; sem ele, nenhuma fonte vira "direta" e **nenhum preço é verificado**);
   - os sites que a busca encontrar (hotéis, ingressos, transporte) para a etapa de verificação, o que na prática pede acesso de rede aberto.

## Rodando

```bash
cd apps/api
export DATABASE_URL=postgresql://...        # banco descartável, com `npx prisma migrate deploy`
export GEMINI_API_KEY=...                   # já vem do ambiente
npm run live-check -- --destination "Lisboa" --days 4
```

Opções: `--model` (padrão `gemini-2.5-flash`), `--days`, `--confirm-manually` (segue adiante confirmando à mão o que a verificação não conseguiu abrir; a nota fica marcada como simulada) e `--fake` (usa os servidores simulados, só para testar o próprio roteiro).

O roteiro cria um usuário e uma viagem novos, percorre as sete etapas aprovando cada uma e imprime, por etapa, o que importa para julgar o resultado. A chave é removida de qualquer saída. Ao final mostra quantas chamadas foram feitas, se alguma falhou e o tempo total.

## O que olhar no resultado

- **Fatos e fontes (base, rota):** quantos fatos têm fonte e quantos links são "diretos". Se quase nenhum for direto, o redirecionamento não está sendo resolvido.
- **Formato:** se há fatos suficientes. "Os resultados da pesquisa não retornaram fatos" indica que o modelo não seguiu o formato `FATO [CATEGORIA] ...`.
- **Unidades do orçamento:** a coluna `unidade` de cada item e a fórmula. Uma diária tratada como total aparece aqui.
- **Dias:** avisos do servidor (limite, duplicados, horários) e se o envio foi recusado.
- **Verificação:** quantos itens ficaram `CONFIRMED`, `NOT_FOUND_ON_PAGE`, `NOT_CHECKABLE` e `UNREACHABLE`.
- **Chamadas:** falhas 429 indicam cota; erro 400 na busca indica que a busca não está disponível para a chave/modelo.

A rodada gasta cerca de 12 chamadas de geração e 4 de busca com fontes por viagem.

# Fluxo de planejamento com IA

O foco do projeto é um fluxo de etapas em que a IA **entrevista antes de sugerir** e **nenhuma etapa avança sem aprovação explícita**.

```
ENTREVISTA → RESTRIÇÕES → BASE → ROTA → DIAS → ORÇAMENTO → VERIFICAÇÃO
```

Entrevista primeiro. Roteiro depois.

## 1. Entrevista
Entrada: `Vou para [DESTINO] de [DATA] a [DATA].`
A IA pergunta sobre orçamento, ritmo, alimentação, mobilidade, horários a evitar e **um item inegociável por viajante**. Organiza as respostas, destaca conflitos entre preferências e espera aprovação.
Exemplos de inegociável: "nenhum passeio começando às 7h"; "uma refeição boa por dia".

## 2. Restrições (aprovadas)
Resultado aprovado da entrevista, versionado. É a entrada de todas as etapas seguintes.

## 3. Base
Agrupa lugares por região e compara até 3 bairros para hospedagem (deslocamento, acesso, custo encontrado nas fontes, compatibilidade com o ritmo). Horários e fechamentos vêm de fontes oficiais; o que não for verificado é marcado. Recomenda uma base, mostra as descartadas e o motivo. **Não monta os dias.** Espera aprovação.

**Como as fontes são tratadas (implementado):**
1. O modelo pesquisa com a busca do Gemini e escreve fatos, um por linha.
2. O servidor liga cada fato às fontes que a busca devolveu, resolve o redirecionamento do Google para a página final e registra a data da consulta. O modelo nunca escreve links.
3. Um segundo passo estrutura a comparação citando só ids de fatos. Um fato sem fonte, ou marcado como não encontrado, fica `NÃO VERIFICADO`.
4. O valor de uma hospedagem só é mantido com link direto, data e moeda; caso contrário é descartado, nunca completado.

## 4. Rota
Pesquisa as atrações a partir da base aprovada (mesmo mecanismo de busca com fontes da etapa 3) e as agrupa em áreas visitadas juntas, reduzindo o vai e volta. Para cada atração registra tempo desde a base, duração, horários e fechamentos, se exige reserva e o ingresso. "Exige reserva" só é informado quando um fato com fonte sustenta; ingresso segue a regra de preço. Ainda **não** distribui por dia: isso é a etapa 5.

## 5. Dias
Distribui a rota aprovada pelos dias da viagem (exige datas). O limite de prioridades por dia vem das restrições aprovadas (`pace.maxPrioritiesPerDay`) ou é informado ao gerar.
- Manhã planejada com horários; tarde flexível, com opções em vez de agenda cheia.
- Tempo entre pontos só quando um fato com fonte informa; senão fica `NÃO VERIFICADO`.
- Um lugar para comer perto da rota de cada dia, com preço sob a regra de preço e a fonte registrada.
- Plano para chuva por dia.
- Uma atração popular que pode não compensar para o perfil, com o critério (custo, fila, deslocamento, duração ou incompatibilidade). É registrada como **avaliação**, nunca como fato, e indica se há evidência com fonte.
- Reservas sinalizadas: `REQUIRED` (fonte confirma) ou `UNKNOWN` (nenhuma fonte diz; confirmar antes de ir).
- O servidor impõe: limite por dia, cada atração uma única vez, horários fora do que se quis evitar, atrações essenciais agendadas ou justificadas, e um lugar para comer e um plano de chuva em cada dia. Espera aprovação.

## 6. Orçamento
Montado a partir dos preços já verificados nas etapas aprovadas (hospedagem da base, ingressos das atrações agendadas, a refeição planejada de cada dia) mais uma busca com fontes para o transporte. Exige orçamento total nas restrições aprovadas.
- O modelo só indica a **unidade** de cada preço (por noite, por pessoa, por dia, total), propõe a divisão percentual entre hospedagem, alimentação, transporte, atrações e margem de imprevisto (mínimo de 5%) e escreve a decisão que reduz cada risco.
- Quantidades, multiplicações, totais e riscos são calculados pelo servidor. Cada linha mostra a fórmula.
- **Riscos** (calculados): `OVER_ALLOCATION` (verificado acima do reservado), `NEAR_LIMIT` (acima de 80%), `LOW_COVERAGE` (itens sem preço verificado, então o total real pode ser maior) e `PARTIAL_SCOPE` (alimentação só estima a refeição planejada). Todo risco precisa de uma decisão antes da aprovação.
- **Regra de preço:** só entra no total um preço `VERIFIED` (link direto, data e moeda), na moeda do orçamento e com unidade conhecida. Os demais ficam listados como `NÃO VERIFICADO`, sem valor. Não há conversão de moedas.
- O envio recalcula tudo a partir dos itens: um item contado sem fonte, ou um total que não bate, é recusado.
- Pessoas e quartos usados nas multiplicações vêm dos viajantes cadastrados (e 1 quarto), ou são informados ao gerar.

## 7. Verificação (a trava)
Antes de reservar, o servidor **abre** as fontes que sustentam o plano e confere se o valor ou horário afirmado realmente aparece na página:
- cada preço que entrou no orçamento (hospedagem, ingressos, refeições, transporte);
- os horários de cada atração agendada, usando a frase encontrada pela pesquisa e não a paráfrase do modelo;
- os **voos**, que não fazem parte do plano e são informados por você com o link da tarifa e o valor ou textos que devem aparecer (número do voo, horário).

Resultado de cada item: `CONFIRMED` (com o trecho da página como evidência), `NOT_FOUND_ON_PAGE`, `NOT_CHECKABLE` (sem link, login, página que carrega por JavaScript, PDF ou endereço bloqueado) ou `UNREACHABLE` (link quebrado ou fora do ar). Itens não conferidos automaticamente podem ser confirmados por você com uma nota do que viu (`MANUALLY_CONFIRMED`).

A aprovação só é possível quando todos os itens estão confirmados, automática ou manualmente, e o plano não mudou depois da verificação. Resultados não podem ser editados à mão: vêm de uma página buscada pelo servidor ou de uma confirmação manual explícita.

Segurança: o servidor só acessa endereços públicos (http/https). Redes internas, `localhost` e endereços de metadados de nuvem são bloqueados no momento da conexão, inclusive em redirecionamentos.

## Regras de implementação
- Cada etapa tem estado (`DRAFT` → `AWAITING_APPROVAL` → `APPROVED`) e só pode iniciar se a anterior estiver `APPROVED`.
- Toda informação factual (preço, horário, fechamento) guarda `sourceUrl`, `consultedAt` e `currency` (quando aplicável) ou o marcador `NÃO VERIFICADO`.
- A IA é chamada pelo backend; o prompt de cada etapa fica versionado no repositório.

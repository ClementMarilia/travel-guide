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

## 4. Rota
Distribui as atrações a partir da base aprovada, reduzindo o vai e volta.

## 5. Dias
- Máximo de N prioridades por dia.
- Manhã planejada, tarde flexível, tempo realista entre pontos, plano para chuva.
- Um lugar para comer perto da rota, compatível com preferências e orçamento, com a fonte consultada.
- Uma atração popular que pode não compensar para o perfil, com o critério explícito (custo, fila, deslocamento, duração ou incompatibilidade). Opinião não é apresentada como fato.
- Sinaliza o que exige reserva. Espera aprovação.

## 6. Orçamento
Distribui por hospedagem, alimentação, transporte, atrações e margem de imprevisto. Mostra os itens com maior risco de estourar e a decisão que reduz cada risco.

**Regra de preço:** só entra no orçamento um valor com **link direto da página onde o preço aparece, data da consulta e moeda**. Sem isso, o item fica `NÃO VERIFICADO`. A IA nunca inventa nem completa preço ausente.

## 7. Verificação (a trava)
Antes de reservar, as fontes de voo, hotel, ingresso e horário que sustentam o plano são abertas e conferidas. Só então o plano é considerado pronto para reserva.

## Regras de implementação
- Cada etapa tem estado (`DRAFT` → `AWAITING_APPROVAL` → `APPROVED`) e só pode iniciar se a anterior estiver `APPROVED`.
- Toda informação factual (preço, horário, fechamento) guarda `sourceUrl`, `consultedAt` e `currency` (quando aplicável) ou o marcador `NÃO VERIFICADO`.
- A IA é chamada pelo backend; o prompt de cada etapa fica versionado no repositório.

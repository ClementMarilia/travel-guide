# Travel Guide

## Visão do Produto

O Travel Guide é uma plataforma SaaS de planejamento de viagens com inteligência artificial.

Proposta central: **sua viagem, suas regras. A IA organiza o resto.**

O usuário informa o que deseja, a IA pesquisa e compara opções, apresenta recomendações fundamentadas e só avança quando as decisões necessárias estiverem aprovadas.

Inspirado na experiência de planejadores como a Layla.ai, mas com identidade própria e três diferenciais:

1. **Aprovação progressiva**: a IA nunca avança de etapa quando há uma decisão do usuário pendente.
2. **Orçamento transparente**: o sistema mostra déficits e nunca reduz valores para fazer o roteiro parecer viável.
3. **Dados verificáveis**: preços, horários e disponibilidade sempre trazem fonte e data de consulta; o que não é verificado é marcado como estimativa.

O produto não vende nem processa reservas ou pagamentos. Ele planeja e aponta links externos.

## Público-alvo

- Casais, famílias e grupos de amigos que planejam em conjunto.
- Viajantes que querem controle de orçamento e de cada decisão.
- Pessoas que gostam de planejar, mas não de pesquisar em dezenas de sites.

## Tecnologias

| Camada                 | Tecnologia                                                  |
| ---------------------- | ----------------------------------------------------------- |
| Frontend               | Next.js + TypeScript                                        |
| UI                     | Tailwind CSS + shadcn/ui                                    |
| Banco / Auth / Storage | Supabase (PostgreSQL, Auth, Storage, RLS)                   |
| IA                     | OpenAI ou Gemini, com saídas estruturadas validadas por Zod |
| Mapas                  | Google Maps ou Mapbox                                       |
| PDF                    | React PDF                                                   |
| E-mail                 | Resend ou equivalente                                       |
| Deploy                 | Vercel                                                      |

## Princípios

- O viajante mantém o controle de cada decisão.
- A IA nunca inventa preços, horários ou disponibilidade.
- Cálculos financeiros e de rotas são determinísticos; o modelo de IA interpreta e propõe, o backend valida.
- Nenhuma alteração silenciosa em decisões aprovadas.
- Dados privados protegidos por autenticação, RLS e validação no backend (GDPR).
- Arquitetura modular: integrações de hospedagem, transporte e atividades são plugáveis.

## Escopo

O escopo detalhado do MVP, as fases e o que fica fora da primeira versão estão em [`mvp-spec.md`](./mvp-spec.md).

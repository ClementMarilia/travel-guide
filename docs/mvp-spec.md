# MVP — Plataforma Inteligente de Viagens

Especificação do produto, versão 1.0. Substitui a versão anterior do escopo em `vision.md`.

## 1. Fluxo em sete etapas

Cada viagem passa por sete etapas, cada uma com dados salvos, validações e status próprio.

1. **Criar viagem**: destino, datas, cidade de origem, quantidade de viajantes.
2. **Conhecer os viajantes**: orçamento, interesses, mobilidade, alimentação, ritmo, prioridades.
3. **Escolher a base**: comparar até três regiões para hospedagem.
4. **Validar a viabilidade**: orçamento, tempo e restrições.
5. **Construir o roteiro**: atividades em dias realistas, com rotas eficientes.
6. **Revisar e aprovar**: alterações, substituições e aprovação final.
7. **Preparar e utilizar**: checklist, compartilhamento, PDF, consulta no celular.

Estados de cada etapa: `not_started`, `in_progress`, `approved`, `needs_review`.

**Regra fundamental:** a IA nunca avança automaticamente quando há decisão do usuário pendente. Se uma alteração anterior afeta etapas posteriores, elas passam a `needs_review` sem apagar o trabalho feito.

## 2. Regras obrigatórias da IA

1. Nunca inventar preços, horários de funcionamento ou disponibilidade.
2. Informar a fonte e a data de verificação dos dados externos importantes.
3. Não alterar decisões aprovadas silenciosamente.
4. Preservar todas as restrições obrigatórias.
5. Identificar conflitos de horários, trajetos e orçamento.
6. Priorizar sites oficiais para funcionamento e fechamento.
7. Permitir rejeitar qualquer recomendação.
8. Usar respostas estruturadas, validadas pelo backend antes de gravar.
9. Registrar versões das decisões e modificações.
10. Reconhecer quando não há dados suficientes.

Dados de preço distinguem três níveis: **confirmado**, **estimado**, **indisponível**.

## 3. Fases

### Fase 1 — Fundação (em andamento)
- Design system e layout responsivo.
- Autenticação Supabase (e-mail e Google), perfis.
- Banco de dados com RLS.
- Criação e gestão de viagens (dashboard).
- Formulário de viajantes com salvamento de progresso.
- Máquina de estados das sete etapas.

### Fase 2 — Inteligência e decisões
- Integração da IA com saídas estruturadas (Zod).
- Análise de preferências e conflitos entre viajantes.
- Comparação de regiões e pesquisa de hospedagens.
- Motor de orçamento e viabilidade (determinístico).

### Fase 3 — Planejamento completo
- Roteiro diário com horários, custos e alternativas.
- Mapa interativo e rotas.
- Assistente contextual com histórico de alterações.

### Fase 4 — Beta
- Colaboração (proprietário, editor, visualizador).
- Checklist, PDF e compartilhamento.
- Painel administrativo, monitoramento, testes e deploy.

## 4. Módulos

| # | Módulo | Fase |
|---|---|---|
| 01 | Landing page e descoberta | 1 |
| 02 | Cadastro e perfil | 1 |
| 03 | Formulário inteligente de viajantes | 1 (IA na 2) |
| 04 | Comparador de regiões e hospedagens | 2 |
| 05 | Validador de orçamento e viabilidade | 2 |
| 06 | Gerador inteligente de roteiros | 3 |
| 07 | Mapa interativo | 3 |
| 08 | Assistente de IA contextual | 3 |
| 09 | Gestão de viagens | 1 |
| 10 | Colaboração entre viajantes | 4 |
| 11 | Checklist, compartilhamento e exportação | 4 |
| 12 | Painel administrativo | 4 |

Idiomas previstos: português, italiano, inglês e espanhol (a estrutura de i18n entra na fase 1; os textos podem chegar aos poucos).

## 5. Telas

| Rota | Tela |
|---|---|
| `/` | Home |
| `/explorar` | Explorar |
| `/login`, `/cadastro` | Autenticação |
| `/dashboard` | Minhas viagens |
| `/viagens/nova` | Nova viagem |
| `/viagens/:id/viajantes` | Preferências |
| `/viagens/:id/regioes` | Comparar regiões |
| `/viagens/:id/hospedagem` | Hospedagens |
| `/viagens/:id/orcamento` | Orçamento |
| `/viagens/:id/roteiro` | Roteiro |
| `/viagens/:id/mapa` | Mapa |
| `/viagens/:id/checklist` | Preparação |
| `/viagens/:id/compartilhar` | Colaboração |
| `/perfil` | Perfil |
| `/admin` | Administração |

## 6. Orçamento

- Diferenciar orçamento total e por pessoa.
- Indicar se hospedagem e transporte até o destino estão incluídos.
- Evitar contagem dupla em despesas compartilhadas.
- Converter moedas registrando a taxa utilizada.
- Reservar margem para imprevistos.
- Alertar quando uma escolha ultrapassar o limite.
- Em viagens inviáveis, mostrar o déficit e sugerir ajustes. Nunca reduzir valores artificialmente.

## 7. Segurança e privacidade

- Row Level Security em todas as tabelas.
- Permissões validadas também no backend.
- Segredos fora do frontend.
- Conformidade com GDPR.
- Administradores não visualizam dados privados de viagem indiscriminadamente.
- Links públicos não expõem dados pessoais nem documentos.

## 8. Critérios de MVP concluído

- Do cadastro ao roteiro aprovado sem intervenção manual.
- Preferências e decisões persistem após fechar e reabrir o navegador.
- A IA respeita requisitos obrigatórios e pede aprovações.
- Orçamento, atividades e mapa permanecem coerentes após alterações.
- Informações externas mostram procedência e limitações.
- Dois usuários compartilham uma viagem com permissões corretas.
- O PDF reflete o roteiro salvo.
- Funciona em celular e desktop.
- Dados privados protegidos por autenticação e autorização.
- Erros de APIs externas não causam perda de dados nem informação inventada.

## 9. Fora da primeira versão

Reservas e pagamentos na aplicação, emissão de bilhetes, consultores humanos, aplicativo nativo, previsão de preços de passagens, vídeos interativos nos mapas, navegação offline e ajustes por localização ao vivo.

## 10. Modelo de negócio

Freemium, sem implementar pagamentos na primeira entrega.

- **Gratuito:** uma viagem ativa, formulário, roteiro e mapa.
- **Pro (futuro):** mais viagens, revisões avançadas, colaboração ampliada.
- **Afiliados (futuro):** comissões de parceiros por serviços contratados externamente.

Os limites dependem de testes de custo de IA.

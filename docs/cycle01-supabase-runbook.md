# Ciclo 01 — Supabase: procedimento controlado

## Achados verificados por consulta somente de leitura (13/10/2026)

Projeto Supabase `tezhmrfpwtvzhwzmovpu` está ACTIVE_HEALTHY.
Banco atual: 4 viagens; nenhuma com `traveler_count > 1`; 1 aprovação da etapa `travelers`; 0 registros em `travel_sources`.
As tabelas principais e `travel_sources` existem com RLS ativo.
A tabela `public.travel_companions` não existe e `public.approve_stage` ainda usa a implementação anterior.
O conector Supabase retornou lista de migrações vazia: **não interpretar isso como banco vazio**.

## Escopo e limites

Não reaplicar todas as migrações históricas: as tabelas já existem.
A migração pendente é `supabase/migrations/20261013200000_travel_companions.sql`.
Esta auditoria NÃO autoriza aplicação direta em produção.

## Gate A — pré-aplicação (read-only)

1. Executar `supabase/audits/cycle01_companions_readonly.sql`.
2. Confirmar existência dos helpers `set_updated_at`, `is_trip_member`, `can_edit_trip`.
3. Confirmar que `travel_companions` não existe.
4. Fazer backup/snapshot recuperável do banco e registrar o resultado.
5. Preparar ambiente de testes isolado com cópia **sem dados pessoais** ou esquema compatível e executar a migração nesse ambiente.
6. Executar smoke tests autenticados (proprietário, editor, viewer, usuário alheio) e aprovações com zero/um/dois acompanhantes, sem criar dados na produção.

## Gate B — verificação após testes de staging

Antes da aplicação em produção, revisar o diff completo do SQL, identificar possíveis políticas/roles afetadas e aprovar explicitamente a janela de implantação. Aplicar somente a migração pendente com mecanismo oficial de migração; não usar este arquivo de auditoria para escrever no banco.

## Gate C — pós-aplicação (read-only)

Reexecutar `cycle01_companions_readonly.sql`; esperar:
- `companion_table_exists = true`;
- `rls_enabled = true` para travel_companions;
- quatro políticas por operação (SELECT/INSERT/UPDATE/DELETE);
- `approval_companion_guard_present = true`;
- contagem de viagens preservada.

Depois validar no aplicativo:
- Owner cria e remove acompanhante, sem exceder `traveler_count - 1`;
- Owner não consegue aprovar preferências incompletas;
- Viewer e usuário externo não conseguem alterar preferências;
- Reabrir etapa aprovada marca etapas posteriores para revisão;
- Dados de viagem não se perdem após recarregar página.

## Rollback

Não presumir que um rollback simples remove o risco. O script modifica uma função de aprovação existente. Se houver falha, parar a implantação, preservar evidências e restaurar de backup ou aplicar uma reversão previamente revisada da função. Não excluir tabela com dados gravados.

## Diagnóstico paralelo Gemini

Os logs de preview mostram HTTP 503 para `/api/chat`; isso **não comprova** problema no Supabase nem garante que toda requisição Gemini falhará. Testes de regressão da camada Gemini estão no PR #12. A configuração da seleção de modelo usa fallback `gemini-3.8-flash` caso a descoberta de modelos não conclua; confirmar validade do fallback no ambiente antes de alterar configurações.

-- Ciclo 01: auditoria de leitura, executar ANTES e DEPOIS da migração de acompanhantes.
-- NÃO contém alterações, INSERT, UPDATE, DELETE, DDL ou dados pessoais.
select
  to_regclass('public.travel_companions') is not null as companion_table_exists,
  to_regprocedure('public.set_updated_at()') is not null as set_updated_at_exists,
  to_regprocedure('public.is_trip_member(uuid)') is not null as membership_helper_exists,
  to_regprocedure('public.can_edit_trip(uuid)') is not null as edit_helper_exists,
  to_regprocedure('public.approve_stage(uuid,public.stage_key)') is not null as approval_function_exists;

select tablename, rowsecurity as rls_enabled
from pg_tables
where schemaname = 'public'
  and tablename in ('trips','trip_stages','travel_sources','travel_companions')
order by tablename;

select tablename, policyname, cmd
from pg_policies
where schemaname = 'public' and tablename = 'travel_companions'
order by policyname;

select count(*) as trip_count,
  count(*) filter (where traveler_count > 1) as multi_traveler_trips
from public.trips;

select count(*) as approved_preferences_count
from public.trip_stages
where stage = 'travelers' and status = 'approved';

select
  position('complete companion preferences before approval' in pg_get_functiondef(p.oid)) > 0
    as approval_companion_guard_present
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname = 'approve_stage'
  and pg_get_function_identity_arguments(p.oid) like '%p_trip uuid%';

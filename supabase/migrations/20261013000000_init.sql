-- Fase 1: fundação. Perfis, viagens, membros, preferências e etapas.
-- Todas as tabelas têm RLS ativada.

create extension if not exists "pgcrypto";

-- Enums ---------------------------------------------------------------

create type trip_status as enum ('planning', 'upcoming', 'ongoing', 'completed', 'archived');
create type member_role as enum ('owner', 'editor', 'viewer');
create type stage_key as enum (
  'create_trip', 'travelers', 'base', 'viability', 'itinerary', 'review', 'prepare'
);
create type stage_status as enum ('not_started', 'in_progress', 'approved', 'needs_review');

-- Helpers -------------------------------------------------------------

create or replace function set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- profiles ------------------------------------------------------------

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  locale text not null default 'pt' check (locale in ('pt', 'it', 'en', 'es')),
  currency text not null default 'EUR',
  travel_style text,
  interests text[] not null default '{}',
  accessibility_needs text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_updated_at before update on profiles
  for each row execute function set_updated_at();

create function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)));
  return new;
end;
$$;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function handle_new_user();

-- trips ---------------------------------------------------------------

create table trips (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles (id) on delete cascade,
  title text not null,
  destination text not null,
  origin_city text,
  start_date date,
  end_date date,
  traveler_count int not null default 1 check (traveler_count >= 1),
  currency text not null default 'EUR',
  total_budget numeric(12, 2) check (total_budget is null or total_budget >= 0),
  status trip_status not null default 'planning',
  cover_image_url text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date is null or start_date is null or end_date >= start_date)
);

create index trips_owner_idx on trips (owner_id);

create trigger trips_updated_at before update on trips
  for each row execute function set_updated_at();

-- trip_members --------------------------------------------------------

create table trip_members (
  trip_id uuid not null references trips (id) on delete cascade,
  user_id uuid not null references profiles (id) on delete cascade,
  role member_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (trip_id, user_id)
);

create index trip_members_user_idx on trip_members (user_id);

-- O proprietário entra automaticamente como membro 'owner'.
create function add_owner_as_member() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into trip_members (trip_id, user_id, role)
  values (new.id, new.owner_id, 'owner');
  return new;
end;
$$;

create trigger trips_add_owner after insert on trips
  for each row execute function add_owner_as_member();

-- Funções de permissão (security definer evita recursão de RLS) ---------

create function is_trip_member(p_trip uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from trip_members where trip_id = p_trip and user_id = auth.uid()
  );
$$;

create function can_edit_trip(p_trip uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from trip_members
    where trip_id = p_trip and user_id = auth.uid() and role in ('owner', 'editor')
  );
$$;

create function is_trip_owner(p_trip uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from trip_members
    where trip_id = p_trip and user_id = auth.uid() and role = 'owner'
  );
$$;

-- traveler_preferences ------------------------------------------------

create table traveler_preferences (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips (id) on delete cascade,
  user_id uuid references profiles (id) on delete set null,
  label text not null,                       -- nome do viajante na viagem
  age_group text,
  pace text check (pace in ('relaxed', 'balanced', 'intense')),
  main_transport text check (main_transport in ('car', 'public', 'mixed')),
  diet text,
  mobility text,
  interests text[] not null default '{}',
  must_haves text[] not null default '{}',   -- exigências obrigatórias
  flexible_prefs text[] not null default '{}',
  avoid_times text,
  activities_per_day int check (activities_per_day between 1 and 6),
  earliest_start time,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (trip_id, user_id)                  -- uma linha por usuário; viajantes sem conta têm user_id nulo
);

create index traveler_preferences_trip_idx on traveler_preferences (trip_id);

create trigger traveler_preferences_updated_at before update on traveler_preferences
  for each row execute function set_updated_at();

-- trip_stages ---------------------------------------------------------

create table trip_stages (
  trip_id uuid not null references trips (id) on delete cascade,
  stage stage_key not null,
  status stage_status not null default 'not_started',
  approved_by uuid references profiles (id) on delete set null,
  approved_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (trip_id, stage)
);

create trigger trip_stages_updated_at before update on trip_stages
  for each row execute function set_updated_at();

-- As sete etapas nascem junto com a viagem.
create function create_trip_stages() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into trip_stages (trip_id, stage, status)
  select new.id, s, case when s = 'create_trip' then 'in_progress'::stage_status else 'not_started'::stage_status end
  from unnest(enum_range(null::stage_key)) as s;
  return new;
end;
$$;

create trigger trips_create_stages after insert on trips
  for each row execute function create_trip_stages();

-- RLS -----------------------------------------------------------------

alter table profiles enable row level security;
alter table trips enable row level security;
alter table trip_members enable row level security;
alter table traveler_preferences enable row level security;
alter table trip_stages enable row level security;

-- profiles: cada pessoa vê e edita só o próprio perfil.
create policy profiles_select on profiles for select using (id = auth.uid());
create policy profiles_update on profiles for update using (id = auth.uid()) with check (id = auth.uid());

-- trips
-- owner_id garante que o INSERT ... RETURNING funcione antes do trigger criar o membro.
create policy trips_select on trips for select using (owner_id = auth.uid() or is_trip_member(id));
create policy trips_insert on trips for insert with check (owner_id = auth.uid());
create policy trips_update on trips for update using (can_edit_trip(id)) with check (can_edit_trip(id));
create policy trips_delete on trips for delete using (is_trip_owner(id));

-- trip_members: membros veem a lista; só o proprietário gerencia.
create policy trip_members_select on trip_members for select using (is_trip_member(trip_id));
create policy trip_members_manage on trip_members for all
  using (is_trip_owner(trip_id)) with check (is_trip_owner(trip_id));

-- traveler_preferences
create policy prefs_select on traveler_preferences for select using (is_trip_member(trip_id));
create policy prefs_write on traveler_preferences for all
  using (can_edit_trip(trip_id)) with check (can_edit_trip(trip_id));

-- trip_stages: aprovação é decisão do proprietário.
create policy stages_select on trip_stages for select using (is_trip_member(trip_id));
create policy stages_update on trip_stages for update
  using (is_trip_owner(trip_id)) with check (is_trip_owner(trip_id));

-- Transições de etapa ---------------------------------------------------
-- A ordem das etapas é a ordem do enum stage_key. Uma etapa só pode ser
-- aprovada se a anterior estiver aprovada; reabrir uma etapa marca as
-- etapas posteriores já aprovadas como 'needs_review' sem apagar dados.

create function approve_stage(p_trip uuid, p_stage stage_key) returns void
language plpgsql security definer set search_path = public as $$
declare
  ord stage_key[] := enum_range(null::stage_key);
  idx int := array_position(enum_range(null::stage_key), p_stage);
begin
  if not is_trip_owner(p_trip) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if idx > 1 and not exists (
    select 1 from trip_stages
    where trip_id = p_trip and stage = ord[idx - 1] and status = 'approved'
  ) then
    raise exception 'previous stage not approved' using errcode = 'P0001';
  end if;

  update trip_stages
     set status = 'approved', approved_by = auth.uid(), approved_at = now()
   where trip_id = p_trip and stage = p_stage;

  if idx < array_length(ord, 1) then
    update trip_stages set status = 'in_progress'
     where trip_id = p_trip and stage = ord[idx + 1] and status = 'not_started';
  end if;
end;
$$;

create function reopen_stage(p_trip uuid, p_stage stage_key) returns void
language plpgsql security definer set search_path = public as $$
declare
  ord stage_key[] := enum_range(null::stage_key);
  idx int := array_position(enum_range(null::stage_key), p_stage);
begin
  if not can_edit_trip(p_trip) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  update trip_stages
     set status = 'in_progress', approved_by = null, approved_at = null
   where trip_id = p_trip and stage = p_stage;

  update trip_stages set status = 'needs_review'
   where trip_id = p_trip and status = 'approved'
     and array_position(ord, stage) > idx;
end;
$$;

revoke all on function approve_stage(uuid, stage_key) from public, anon;
revoke all on function reopen_stage(uuid, stage_key) from public, anon;
grant execute on function approve_stage(uuid, stage_key) to authenticated;
grant execute on function reopen_stage(uuid, stage_key) to authenticated;

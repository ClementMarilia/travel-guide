-- Fase 2: regiões (base da viagem) e orçamento com procedência dos valores.

create type price_status as enum ('confirmed', 'estimated', 'unavailable');

-- trip_regions -----------------------------------------------------------

create table trip_regions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 150),
  summary text,
  pros text[] not null default '{}',
  cons text[] not null default '{}',
  access text,
  walkability text,
  parking text,
  fit text,
  price_min numeric(12, 2) check (price_min is null or price_min >= 0), -- por noite, por quarto
  price_max numeric(12, 2) check (price_max is null or price_max >= price_min),
  price_status price_status not null default 'estimated',
  source text not null default 'Estimativa da IA (não verificada)',
  chosen boolean not null default false,
  generated_at timestamptz not null default now()
);

create index trip_regions_trip_idx on trip_regions (trip_id);
create unique index trip_regions_one_chosen on trip_regions (trip_id) where chosen;

-- budget_items -----------------------------------------------------------

create table budget_items (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips (id) on delete cascade,
  category text not null check (category in ('lodging', 'food', 'transport', 'activities', 'buffer')),
  planned numeric(12, 2) not null default 0 check (planned >= 0),
  est_min numeric(12, 2) check (est_min is null or est_min >= 0),
  est_max numeric(12, 2) check (est_max is null or est_max >= est_min),
  status price_status not null default 'estimated',
  source text,
  region_id uuid references trip_regions (id) on delete set null, -- região usada na estimativa de hospedagem
  updated_at timestamptz not null default now(),
  unique (trip_id, category)
);

create trigger budget_items_updated_at before update on budget_items
  for each row execute function set_updated_at();

-- RLS ---------------------------------------------------------------------

alter table trip_regions enable row level security;
alter table budget_items enable row level security;

create policy regions_select on trip_regions for select using (is_trip_member(trip_id));
create policy regions_write on trip_regions for all
  using (can_edit_trip(trip_id)) with check (can_edit_trip(trip_id));

create policy budget_select on budget_items for select using (is_trip_member(trip_id));
create policy budget_write on budget_items for all
  using (can_edit_trip(trip_id)) with check (can_edit_trip(trip_id));

-- Escolher a base: troca a região escolhida de forma atômica. Se a base já estava
-- aprovada, reabre a etapa e marca as seguintes para revisão (nada muda em silêncio).
create function choose_region(p_trip uuid, p_region uuid) returns void
language plpgsql set search_path = public as $$
begin
  if not can_edit_trip(p_trip) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (select 1 from trip_regions where id = p_region and trip_id = p_trip) then
    raise exception 'region not found' using errcode = 'P0002';
  end if;

  update trip_regions set chosen = false where trip_id = p_trip and chosen and id <> p_region;
  update trip_regions set chosen = true where id = p_region;

  if exists (select 1 from trip_stages where trip_id = p_trip and stage = 'base' and status = 'approved') then
    perform reopen_stage(p_trip, 'base');
  end if;
end;
$$;

revoke all on function choose_region(uuid, uuid) from public, anon;
grant execute on function choose_region(uuid, uuid) to authenticated;

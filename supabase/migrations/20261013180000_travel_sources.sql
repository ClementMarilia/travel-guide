-- Proveniência das informações da viagem. Nenhum link informado por usuário
-- passa a ser "verificado" automaticamente.
create table travel_sources (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  region_id uuid references trip_regions(id) on delete cascade,
  label text not null check (char_length(label) between 1 and 180),
  url text not null check (char_length(url) between 12 and 2048 and url ~* '^https://'),
  category text not null default 'lodging'
    check (category in ('lodging','attraction','transport','food','official','other')),
  verification_status text not null default 'unverified'
    check (verification_status in ('unverified','verified','outdated')),
  checked_at timestamptz,
  added_by uuid references profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  check (verification_status <> 'verified' or checked_at is not null)
);

create index travel_sources_trip_idx on travel_sources(trip_id, created_at desc);
create index travel_sources_region_idx on travel_sources(region_id);

-- Evita que uma URL associada a uma região de outra viagem seja gravada.
create function check_travel_source_region() returns trigger
language plpgsql set search_path=public as $$
begin
  if new.region_id is not null and not exists (
    select 1 from trip_regions where id = new.region_id and trip_id = new.trip_id
  ) then
    raise exception 'region does not belong to trip' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger travel_sources_region_integrity before insert or update on travel_sources
  for each row execute function check_travel_source_region();

alter table travel_sources enable row level security;
create policy travel_sources_select on travel_sources for select using (is_trip_member(trip_id));
create policy travel_sources_insert on travel_sources for insert with check (
  can_edit_trip(trip_id) and added_by = auth.uid()
  and verification_status = 'unverified' and checked_at is null
);
create policy travel_sources_delete on travel_sources for delete using (is_trip_owner(trip_id));

-- Não há política UPDATE: fontes de usuário não podem ser promovidas a verificadas
-- pela API pública. Uma integração futura validará a procedência no servidor.

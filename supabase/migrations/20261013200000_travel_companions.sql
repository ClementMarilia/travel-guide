-- Entrevista individual dos acompanhantes, sem exigir conta.
create table travel_companions (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete cascade,
  display_name text not null check (char_length(trim(display_name)) between 1 and 80),
  pace text check (pace in ('relaxed','balanced','intense')),
  diet text check (diet is null or char_length(diet) <= 500),
  mobility text check (mobility is null or char_length(mobility) <= 1000),
  avoid_times text check (avoid_times is null or char_length(avoid_times) <= 500),
  must_have text not null check (char_length(trim(must_have)) between 1 and 300),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index travel_companions_trip_idx on travel_companions(trip_id);
create trigger travel_companions_updated_at before update on travel_companions
  for each row execute function set_updated_at();

alter table travel_companions enable row level security;
create policy travel_companions_select on travel_companions
  for select using (is_trip_member(trip_id));
create policy travel_companions_insert on travel_companions
  for insert with check (can_edit_trip(trip_id));
create policy travel_companions_update on travel_companions
  for update using (can_edit_trip(trip_id)) with check (can_edit_trip(trip_id));
create policy travel_companions_delete on travel_companions
  for delete using (can_edit_trip(trip_id));

-- Exige que cada acompanhante da viagem tenha uma entrevista antes da aprovação.
-- Reutiliza a regra original de ordem e não apaga aprovações existentes.
create or replace function approve_stage(p_trip uuid, p_stage stage_key) returns void
language plpgsql security definer set search_path = public as $$
declare
  ord stage_key[] := enum_range(null::stage_key);
  idx int := array_position(enum_range(null::stage_key), p_stage);
  expected_count int;
  actual_count int;
begin
  if not is_trip_owner(p_trip) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_stage = 'travelers' then
    select greatest(traveler_count - 1, 0) into expected_count from trips where id = p_trip;
    select count(*) into actual_count from travel_companions where trip_id = p_trip;
    if actual_count <> expected_count then
      raise exception 'complete companion preferences before approval' using errcode = 'P0001';
    end if;
  end if;
  if idx > 1 and not exists (
    select 1 from trip_stages
    where trip_id = p_trip and stage = ord[idx - 1] and status = 'approved'
  ) then
    raise exception 'previous stage not approved' using errcode = 'P0001';
  end if;
  update trip_stages set status = 'approved', approved_by = auth.uid(), approved_at = now()
    where trip_id = p_trip and stage = p_stage;
  if idx < array_length(ord, 1) then
    update trip_stages set status = 'in_progress'
    where trip_id = p_trip and stage = ord[idx + 1] and status = 'not_started';
  end if;
end;
$$;

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

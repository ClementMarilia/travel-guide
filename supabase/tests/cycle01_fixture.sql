-- Test-only Supabase-compatible schema. Synthetic identities; no production connection.
create schema if not exists auth;
create role authenticated nologin;
create type public.stage_key as enum ('travelers','regions','budget','itinerary');
create table public.trips (id uuid primary key, traveler_count integer not null);
create table public.trip_members (trip_id uuid not null references public.trips(id), user_id uuid not null, role text not null, primary key(trip_id,user_id));
create table public.trip_stages (trip_id uuid not null references public.trips(id), stage public.stage_key not null, status text not null default 'not_started', approved_by uuid, approved_at timestamptz, primary key(trip_id,stage));

create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub', true),'')::uuid
$$;
create function public.set_updated_at() returns trigger language plpgsql as $$
begin new.updated_at=now(); return new; end $$;
create function public.is_trip_member(p_trip uuid) returns boolean language sql security definer set search_path=public as $$
 select exists(select 1 from trip_members where trip_id=p_trip and user_id=auth.uid())
$$;
create function public.can_edit_trip(p_trip uuid) returns boolean language sql security definer set search_path=public as $$
 select exists(select 1 from trip_members where trip_id=p_trip and user_id=auth.uid() and role in ('owner','editor'))
$$;
create function public.is_trip_owner(p_trip uuid) returns boolean language sql security definer set search_path=public as $$
 select exists(select 1 from trip_members where trip_id=p_trip and user_id=auth.uid() and role='owner')
$$;
insert into public.trips values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',3);
insert into public.trip_members values
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','11111111-1111-1111-1111-111111111111','owner'),
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','22222222-2222-2222-2222-222222222222','editor'),
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','33333333-3333-3333-3333-333333333333','viewer');
insert into public.trip_stages(trip_id,stage,status) values
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','travelers','in_progress'),
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','regions','not_started'),
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','budget','not_started'),
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','itinerary','not_started');
grant usage on schema public,auth to authenticated;
grant select,insert,update,delete on all tables in schema public to authenticated;
grant execute on all functions in schema public,auth to authenticated;

-- Called after original migration. Fail CI if any assertion fails.
grant select,insert,update,delete on public.travel_companions to authenticated;
set role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
do $$
begin
 if not (select relrowsecurity from pg_class where oid='public.travel_companions'::regclass) then raise exception 'RLS disabled'; end if;
 if (select count(*) from pg_policies where schemaname='public' and tablename='travel_companions') <> 4 then raise exception 'Expected four RLS policies'; end if;
 begin
  perform public.approve_stage('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','travelers');
  raise exception 'Incomplete companions were incorrectly approved';
 exception when sqlstate 'P0001' then
  if sqlerrm <> 'complete companion preferences before approval' then raise; end if;
 end;
end $$;
insert into public.travel_companions(trip_id,display_name,must_have) values
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Traveler A','Accessible hotel');
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
insert into public.travel_companions(trip_id,display_name,must_have) values
('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','Traveler B','Vegetarian meals');
select set_config('request.jwt.claim.sub','33333333-3333-3333-3333-333333333333',false);
do $$
begin
 if (select count(*) from public.travel_companions) <> 2 then raise exception 'Viewer cannot read'; end if;
 begin
  insert into public.travel_companions(trip_id,display_name,must_have) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','No','No');
  raise exception 'Viewer was incorrectly allowed to write';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','44444444-4444-4444-4444-444444444444',false);
do $$
begin
 if (select count(*) from public.travel_companions) <> 0 then raise exception 'Stranger read companions'; end if;
 begin
  insert into public.travel_companions(trip_id,display_name,must_have) values ('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','No','No');
  raise exception 'Stranger was incorrectly allowed to write';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','22222222-2222-2222-2222-222222222222',false);
do $$
begin
 begin
  perform public.approve_stage('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','travelers');
  raise exception 'Editor was incorrectly allowed to approve';
 exception when insufficient_privilege then null; end;
end $$;
select set_config('request.jwt.claim.sub','11111111-1111-1111-1111-111111111111',false);
select public.approve_stage('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa','travelers');
do $$
begin
 if (select status from public.trip_stages where stage='travelers') <> 'approved' then raise exception 'Approval missing'; end if;
 if (select status from public.trip_stages where stage='regions') <> 'in_progress' then raise exception 'Next stage did not start'; end if;
end $$;
reset role;

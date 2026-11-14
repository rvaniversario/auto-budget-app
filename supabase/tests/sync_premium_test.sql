-- Sync is a Premium feature, enforced on the server. Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(14);

insert into auth.users (id, email, aud, role)
values
  ('33333333-0000-0000-0000-000000000001', 'free@example.com', 'authenticated', 'authenticated'),
  ('33333333-0000-0000-0000-000000000002', 'legacy@example.com', 'authenticated', 'authenticated'),
  ('33333333-0000-0000-0000-000000000003', 'trial@example.com', 'authenticated', 'authenticated'),
  ('33333333-0000-0000-0000-000000000004', 'expired@example.com', 'authenticated', 'authenticated');

insert into public.entitlements (user_id, plan, source, starts_at, expires_at, trial_used, legacy_sync) values
  ('33333333-0000-0000-0000-000000000002', 'free', null, null, null, false, true),
  ('33333333-0000-0000-0000-000000000003', 'premium', 'trial', now(), now() + interval '14 days', true, false),
  ('33333333-0000-0000-0000-000000000004', 'premium', 'trial', now() - interval '15 days', now() - interval '1 day', true, false);

-- A record the expired-trial user synced while the trial ran (written as the service role).
insert into public.sync_records (user_id, collection, record_id, data, updated_at)
values ('33333333-0000-0000-0000-000000000004', 'transactions', 'old', '{"id":"old","updatedAt":"2026-11-01T00:00:00Z"}', '2026-11-01');

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.one(id text) returns jsonb language sql as $$
  select jsonb_build_array(jsonb_build_object('collection', 'transactions', 'data',
    jsonb_build_object('id', id, 'updatedAt', '2026-11-15T10:00:00.000Z')))
$$;

-- ---- Free account: refused -------------------------------------------------
select pg_temp.act_as('33333333-0000-0000-0000-000000000001');
select ok(not public.can_sync('33333333-0000-0000-0000-000000000001'), 'a free account cannot sync');
select throws_ok($$ select public.sync_push('web', '', pg_temp.one('f1')) $$, 'P0001', 'Sync is part of Premium', 'a free account cannot push');
select throws_ok($$ select public.sync_pull('web', '', 0) $$, 'P0001', 'Sync is part of Premium', 'a free account cannot pull');
select throws_ok($$ select public.sync_status() $$, 'P0001', 'Sync is part of Premium', 'a free account cannot read sync status');
select ok(not public.can_sync('33333333-0000-0000-0000-000000000002'), 'a user cannot ask about another account');

-- ---- Legacy account: allowed without Premium -------------------------------
select pg_temp.act_as('33333333-0000-0000-0000-000000000002');
select ok(public.can_sync('33333333-0000-0000-0000-000000000002'), 'an account that synced before version 2 can sync');
select is((public.sync_push('web', '', pg_temp.one('l1')) ->> 'accepted')::int, 1, 'a legacy account can push');

-- ---- Trial: allowed --------------------------------------------------------
select pg_temp.act_as('33333333-0000-0000-0000-000000000003');
select is((public.sync_push('web', '', pg_temp.one('t1')) ->> 'accepted')::int, 1, 'a running trial can push');
select is(jsonb_array_length(public.sync_pull('phone', '', 0) -> 'records'), 1, 'a running trial can pull');

-- ---- Expired trial: refused, server copy kept ------------------------------
select pg_temp.act_as('33333333-0000-0000-0000-000000000004');
select throws_ok($$ select public.sync_pull('web', '', 0) $$, 'P0001', 'Sync is part of Premium', 'sync stops when the trial ends');
select is((select count(*)::int from public.sync_records), 0, 'row-level security hides synced rows after the trial');
reset role;
select is(
  (select count(*)::int from public.sync_records where user_id = '33333333-0000-0000-0000-000000000004'),
  1, 'the server copy is kept so sync can resume'
);

-- ---- Unlocking later resumes ----------------------------------------------
set local role service_role;
select is((public.grant_premium('33333333-0000-0000-0000-000000000004')).source, 'grant', 'Premium is unlocked');
reset role;
select pg_temp.act_as('33333333-0000-0000-0000-000000000004');
select is(jsonb_array_length(public.sync_pull('web', '', 0) -> 'records'), 1, 'after unlocking, sync resumes with the kept server copy');
reset role;

select * from finish();
rollback;

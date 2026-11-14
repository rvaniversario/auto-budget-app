-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(20);

-- Two users.
insert into auth.users (id, email, aud, role)
values
  ('11111111-1111-1111-1111-111111111111', 'a@example.com', 'authenticated', 'authenticated'),
  ('22222222-2222-2222-2222-222222222222', 'b@example.com', 'authenticated', 'authenticated');

-- Sync is Premium: both users may sync (tests for the gate are in sync_premium_test.sql).
insert into public.entitlements (user_id, plan, legacy_sync) values
  ('11111111-1111-1111-1111-111111111111', 'free', true),
  ('22222222-2222-2222-2222-222222222222', 'free', true);

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.rec(id text, updated text, deleted text default null, note text default '') returns jsonb
language sql as $$
  select jsonb_build_object('collection', 'transactions', 'data',
    jsonb_build_object('id', id, 'updatedAt', updated, 'deletedAt', deleted, 'note', note))
$$;

-- ---- Anonymous callers ----------------------------------------------------
set local role anon;
select throws_ok(
  $$ select public.sync_push('dev', '', '[]'::jsonb) $$,
  '42501', null, 'anon cannot push'
);
select throws_ok($$ select * from public.sync_records $$, '42501', null, 'anon cannot read sync records');
reset role;

-- ---- User A pushes ---------------------------------------------------------
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select is(
  public.sync_push('phone', 'iPhone', jsonb_build_array(
    pg_temp.rec('t1', '2026-11-01T10:00:00.000Z', null, 'first'),
    pg_temp.rec('t2', '2026-11-01T10:00:00.000Z')
  )),
  '{"accepted": 2, "ignored": 0}'::jsonb,
  'push stores new records'
);

select is(
  public.sync_push('phone', 'iPhone', jsonb_build_array(pg_temp.rec('t1', '2026-10-01T00:00:00.000Z', null, 'older'))),
  '{"accepted": 0, "ignored": 1}'::jsonb,
  'an older version is ignored'
);
select is(
  (select data ->> 'note' from public.sync_records where record_id = 't1'),
  'first',
  'the newer server version is kept'
);

select is(
  public.sync_push('phone', 'iPhone', jsonb_build_array(pg_temp.rec('t1', '2026-11-01T10:00:00.000Z', null, 'same time'))),
  '{"accepted": 0, "ignored": 1}'::jsonb,
  'the same version is not rewritten'
);

select is(
  public.sync_push('laptop', 'Windows', jsonb_build_array(pg_temp.rec('t1', '2026-11-02T08:00:00.000Z', '2026-11-02T08:00:00.000Z'))),
  '{"accepted": 1, "ignored": 0}'::jsonb,
  'a newer tombstone replaces the record'
);
select ok(
  (select deleted_at is not null from public.sync_records where record_id = 't1'),
  'deletedAt is stored'
);

select is(
  public.sync_push('phone', 'iPhone', jsonb_build_array(
    pg_temp.rec('t3', '2026-11-03T00:00:00.000Z', null, 'a'),
    pg_temp.rec('t3', '2026-11-04T00:00:00.000Z', null, 'b')
  )) ->> 'accepted',
  '1',
  'duplicates in one push keep the newest'
);
select is((select data ->> 'note' from public.sync_records where record_id = 't3'), 'b', 'the newest duplicate wins');

-- ---- Pulling ---------------------------------------------------------------
select is(
  jsonb_array_length(public.sync_pull('fresh', 'Android', 0, 500) -> 'records'),
  3,
  'a full pull returns every record, deleted ones included'
);
select is(
  (select jsonb_agg(r -> 'data' ->> 'id' order by r -> 'data' ->> 'id')
     from jsonb_array_elements(public.sync_pull('phone', 'iPhone', (select min(rev) from public.sync_records), 500) -> 'records') r),
  '["t1"]'::jsonb,
  'an incremental pull skips records this device wrote'
);
select is(
  (public.sync_pull('fresh', 'Android', 0, 2) ->> 'hasMore')::boolean,
  true,
  'pull pages with hasMore'
);
select ok(
  (public.sync_pull('fresh', 'Android', (public.sync_pull('fresh', 'Android', 0, 500) ->> 'cursor')::bigint, 500) -> 'records') = '[]'::jsonb,
  'nothing is returned after the latest cursor'
);

select is(
  public.sync_status() -> 'counts',
  '{"transactions": 2}'::jsonb,
  'status counts live records only'
);
select is(
  jsonb_array_length(public.sync_status() -> 'devices'),
  3,
  'status lists the devices that synced'
);

-- ---- Direct writes are refused ----------------------------------------------
select throws_ok(
  $$ insert into public.sync_records (user_id, collection, record_id, data, updated_at)
     values ('11111111-1111-1111-1111-111111111111', 'x', 'y', '{}', now()) $$,
  '42501', null, 'users cannot insert directly'
);
select throws_ok(
  $$ update public.sync_records set data = '{}' $$,
  '42501', null, 'users cannot update directly'
);

-- ---- User B is isolated -------------------------------------------------------
select pg_temp.act_as('22222222-2222-2222-2222-222222222222');
select is((select count(*)::int from public.sync_records), 0, 'another user sees none of A''s rows');
select is(
  jsonb_array_length(public.sync_pull('b-phone', '', 0, 500) -> 'records'),
  0,
  'another user pulls none of A''s rows'
);

select * from finish();
rollback;

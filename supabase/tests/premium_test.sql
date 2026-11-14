-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(34);

insert into auth.users (id, email, aud, role, email_confirmed_at)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.com', 'authenticated', 'authenticated', now()),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'b@example.com', 'authenticated', 'authenticated', now()),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'tester@example.com', 'authenticated', 'authenticated', now()),
  ('aaaaaaaa-0000-0000-0000-000000000004', 'unverified@example.com', 'authenticated', 'authenticated', null);

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

create function pg_temp.record(uid uuid, token text, is_test boolean default false) returns text language sql as $$
  select public.record_play_purchase(uid, token, 'GPA.' || token, 'premium_unlock', 399000000, 'PHP', is_test, false, now(), '{}')
$$;

-- ---- Guests ----------------------------------------------------------------
set local role anon;
select throws_ok($$ select public.start_trial() $$, '42501', null, 'guests cannot start a trial');
reset role;

-- ---- Trial -----------------------------------------------------------------
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select is((public.start_trial()).source, 'trial', 'a user can start the trial');
select ok(
  (select expires_at between now() + interval '13 days 23 hours' and now() + interval '14 days 1 minute' from public.entitlements),
  'the trial lasts 14 days'
);
select throws_ok($$ select public.start_trial() $$, 'P0001', 'The free trial has already been used', 'the trial cannot be started twice');

-- ---- Clients cannot write --------------------------------------------------
select throws_ok(
  $$ update public.entitlements set expires_at = null $$,
  '42501', null, 'a user cannot make their trial permanent'
);
select throws_ok(
  $$ insert into public.entitlements (user_id, plan, source) values ('aaaaaaaa-0000-0000-0000-000000000001', 'premium', 'grant') $$,
  '42501', null, 'a user cannot insert an entitlement'
);
select throws_ok($$ delete from public.entitlements $$, '42501', null, 'a user cannot delete an entitlement');
select throws_ok(
  $$ insert into public.purchases (user_id, provider, provider_payment_id, status)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'google_play', 'tok_fake', 'paid') $$,
  '42501', null, 'a user cannot insert a purchase'
);
select throws_ok($$ update public.purchases set status = 'paid' $$, '42501', null, 'a user cannot update a purchase');
select throws_ok(
  $$ select public.grant_premium('aaaaaaaa-0000-0000-0000-000000000001') $$,
  '42501', null, 'a user cannot grant themselves Premium'
);
select throws_ok(
  $$ select public.record_play_purchase('aaaaaaaa-0000-0000-0000-000000000001', 'tok_x', 'GPA.x', 'premium_unlock', 1, 'PHP', false, false, now(), '{}') $$,
  '42501', null, 'a user cannot record a purchase'
);
select throws_ok(
  $$ select public.apply_tester_grant('aaaaaaaa-0000-0000-0000-000000000001') $$,
  '42501', null, 'a user cannot apply a tester grant'
);
select throws_ok($$ select * from public.tester_grants $$, '42501', null, 'users cannot read tester grants');
select throws_ok($$ insert into public.tester_grants (email) values ('me@example.com') $$, '42501', null, 'users cannot add tester grants');

-- ---- Purchase (as verify-play-purchase, service role) ----------------------
reset role;
set local role service_role;
select is(pg_temp.record('aaaaaaaa-0000-0000-0000-000000000001', 'tok_1'), 'recorded', 'a verified purchase is recorded');
select ok(
  (select plan = 'premium' and source = 'purchase' and expires_at is null from public.entitlements
   where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'buying during a trial unlocks Premium permanently'
);
select is(pg_temp.record('aaaaaaaa-0000-0000-0000-000000000001', 'tok_1'), 'already_recorded', 'the same token is processed once');
select is((select count(*)::int from public.purchases where provider_payment_id = 'tok_1'), 1, 'no duplicate purchase row');
select is(pg_temp.record('aaaaaaaa-0000-0000-0000-000000000002', 'tok_1'), 'other_account', 'a token belonging to another account is refused');
select ok(
  not exists (select 1 from public.entitlements where user_id = 'aaaaaaaa-0000-0000-0000-000000000002' and plan = 'premium'),
  'the other account gets nothing'
);

-- ---- Isolation -------------------------------------------------------------
reset role;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000002');
select is((select count(*)::int from public.entitlements), 0, 'another user cannot read the entitlement');
select is((select count(*)::int from public.purchases), 0, 'another user cannot read the purchases');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select is((select count(*)::int from public.purchases), 1, 'a user reads their own purchases');
select throws_ok($$ select public.start_trial() $$, 'P0001', 'Premium is already unlocked', 'an account that owns Premium cannot start a trial');

-- ---- Refund ----------------------------------------------------------------
reset role;
set local role service_role;
select is(public.record_play_refund('tok_1', '{}'), 'refunded', 'a refund is recorded');
select is(public.record_play_refund('tok_1', '{}'), 'already_refunded', 'a repeated refund notification is ignored');
select ok(
  (select plan = 'free' and trial_used from public.entitlements where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'a refund returns the account to free (trial still used)'
);

-- ---- Tester grants ---------------------------------------------------------
insert into public.tester_grants (email, note) values ('tester@example.com', 'closed test'), ('unverified@example.com', 'unverified');
select ok(public.apply_tester_grant('aaaaaaaa-0000-0000-0000-000000000003'), 'a tester grant applies to the matching verified email');
select ok(
  (select plan = 'premium' and source = 'grant' and tester_grant and expires_at is null from public.entitlements
   where user_id = 'aaaaaaaa-0000-0000-0000-000000000003'),
  'the tester has permanent Premium'
);
select ok(not public.apply_tester_grant('aaaaaaaa-0000-0000-0000-000000000004'), 'an unverified email gets no grant');

delete from public.tester_grants where email = 'tester@example.com';
select is(public.revoke_tester_grants(), 1, 'revoke_tester_grants removes grants whose row was deleted');
select ok(
  (select plan = 'free' from public.entitlements where user_id = 'aaaaaaaa-0000-0000-0000-000000000003'),
  'the tester is back to free'
);

-- ---- Test purchases --------------------------------------------------------
select is(pg_temp.record('aaaaaaaa-0000-0000-0000-000000000002', 'tok_test', true), 'recorded', 'a license-tester purchase grants Premium');
select is(public.revoke_test_entitlements(), 1, 'revoke_test_entitlements returns test-only Premium to free');

select * from finish();
rollback;

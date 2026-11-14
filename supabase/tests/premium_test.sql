-- Run with: npx supabase test db
begin;
create extension if not exists pgtap with schema extensions;
select plan(24);

insert into auth.users (id, email, aud, role)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'a@example.com', 'authenticated', 'authenticated'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'b@example.com', 'authenticated', 'authenticated');

create function pg_temp.act_as(uid uuid) returns void language plpgsql as $$
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', json_build_object('sub', uid, 'role', 'authenticated')::text, true);
end $$;

-- ---- Products --------------------------------------------------------------
set local role anon;
select is((select amount from public.products where code = 'premium_lifetime'), 39900, 'anyone can read the price (₱399 in centavos)');
select throws_ok($$ update public.products set amount = 1 $$, '42501', null, 'nobody can change the price from a client');
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
  $$ insert into public.purchases (user_id, provider, product_code, amount, status)
     values ('aaaaaaaa-0000-0000-0000-000000000001', 'paymongo', 'premium_lifetime', 39900, 'paid') $$,
  '42501', null, 'a user cannot insert a purchase'
);
select throws_ok($$ update public.purchases set status = 'paid' $$, '42501', null, 'a user cannot update a purchase');
select throws_ok(
  $$ select public.grant_premium('aaaaaaaa-0000-0000-0000-000000000001') $$,
  '42501', null, 'a user cannot grant themselves Premium'
);
select throws_ok(
  $$ select public.record_payment(gen_random_uuid(), 'pay_x', 39900, 'PHP', 'gcash', now(), '{}') $$,
  '42501', null, 'a user cannot record a payment'
);
select throws_ok($$ select * from public.payment_events $$, '42501', null, 'users cannot read webhook events');

-- ---- Isolation -------------------------------------------------------------
reset role;
insert into public.purchases (id, user_id, provider, provider_checkout_id, product_code, amount)
values ('bbbbbbbb-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'paymongo', 'cs_1', 'premium_lifetime', 39900);

select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000002');
select is((select count(*)::int from public.entitlements), 0, 'another user cannot read the entitlement');
select is((select count(*)::int from public.purchases), 0, 'another user cannot read the purchases');
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select is((select count(*)::int from public.purchases), 1, 'a user reads their own purchases');

-- ---- Payment (as the webhook, service role) -------------------------------
reset role;
set local role service_role;
select is(
  public.record_payment('bbbbbbbb-0000-0000-0000-000000000001', 'pay_1', 39900, 'PHP', 'gcash', now(), '{}'),
  'paid', 'a matching payment is recorded'
);
select ok(
  (select plan = 'premium' and source = 'purchase' and expires_at is null from public.entitlements
   where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'paying during a trial unlocks Premium permanently'
);
select is(
  public.record_payment('bbbbbbbb-0000-0000-0000-000000000001', 'pay_1', 39900, 'PHP', 'gcash', now(), '{}'),
  'already_processed', 'a duplicate webhook is processed once'
);

reset role;
select pg_temp.act_as('aaaaaaaa-0000-0000-0000-000000000001');
select throws_ok($$ select public.start_trial() $$, 'P0001', 'Premium is already unlocked', 'a paid account cannot start a trial');
reset role;
set local role service_role;

select is(public.record_refund('pay_1', 10000, '{}'), 'partial_refund', 'a partial refund keeps Premium');
select is(public.record_refund('pay_1', 29900, '{}'), 'refunded', 'a full refund is recorded');
select ok(
  (select plan = 'free' and trial_used from public.entitlements where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'a refund returns the account to free (trial still used)'
);

select * from finish();
rollback;

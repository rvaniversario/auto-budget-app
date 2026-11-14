-- Premium moves from PayMongo checkout to Google Play in-app billing (see
-- docs/SPEC-V2.md and docs/SPEC-NATIVE.md). Additive on top of the premium
-- migration: existing entitlements and trials are kept.
--
-- Every write is still server-only: verify-play-purchase and play-notifications
-- (service role) call record_play_purchase / record_play_refund; premium/status
-- calls apply_tester_grant for the signed-in user.

-- ---------------------------------------------------------------------------
-- PayMongo pieces that no longer apply. The price now lives in Play Console.
-- ---------------------------------------------------------------------------

drop function if exists public.record_payment(uuid, text, integer, text, text, timestamptz, jsonb);
drop function if exists public.record_refund(text, integer, jsonb);

alter table public.purchases drop constraint if exists purchases_product_code_fkey;
drop table if exists public.products;

-- ---------------------------------------------------------------------------
-- Purchases: Google Play fields. provider_payment_id holds the purchase token.
-- ---------------------------------------------------------------------------

alter table public.purchases
  alter column product_code drop not null,
  alter column amount drop not null,
  add column order_id text,
  add column product_id text,
  -- As reported by Google, for records only.
  add column amount_micros bigint,
  add column acknowledged boolean not null default false,
  -- True for license-tester purchases (Google's purchaseType = 0).
  add column is_test boolean not null default false;

-- ---------------------------------------------------------------------------
-- Entitlements: mark Premium that came from a tester grant, so it can be
-- revoked without touching support grants.
-- ---------------------------------------------------------------------------

alter table public.entitlements add column tester_grant boolean not null default false;

-- ---------------------------------------------------------------------------
-- Tester grants: Premium for testers without a purchase. Service role only.
-- ---------------------------------------------------------------------------

create table public.tester_grants (
  email text primary key check (email = lower(email)),
  -- Null means until the row is removed.
  expires_at timestamptz,
  note text,
  created_at timestamptz not null default now()
);

alter table public.tester_grants enable row level security;
revoke all on public.tester_grants from anon, authenticated;
-- No policies: only the service role reaches it.

-- ---------------------------------------------------------------------------
-- start_trial: same rules, and it never replaces a running grant.
-- ---------------------------------------------------------------------------

create or replace function public.start_trial()
returns public.entitlements
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  current public.entitlements;
begin
  if uid is null then
    raise exception 'Sign in required' using errcode = '28000';
  end if;

  select * into current from public.entitlements where user_id = uid for update;

  if found and current.plan = 'premium' and (current.expires_at is null or (current.source = 'grant' and current.expires_at > now())) then
    raise exception 'Premium is already unlocked' using errcode = 'P0001', hint = 'already_premium';
  end if;
  if found and current.trial_used then
    raise exception 'The free trial has already been used' using errcode = 'P0001', hint = 'trial_used';
  end if;

  insert into public.entitlements as e (user_id, plan, source, starts_at, expires_at, trial_used, tester_grant, updated_at)
  values (uid, 'premium', 'trial', now(), now() + interval '14 days', true, false, now())
  on conflict (user_id) do update
    set plan = 'premium', source = 'trial', starts_at = now(), expires_at = now() + interval '14 days',
        trial_used = true, tester_grant = false, trial_reminder_sent_at = null, updated_at = now()
  returning * into current;

  return current;
end;
$$;

-- ---------------------------------------------------------------------------
-- grant_premium: now takes an optional expiry (null = permanent).
-- ---------------------------------------------------------------------------

drop function if exists public.grant_premium(uuid);

create function public.grant_premium(p_user_id uuid, p_expires_at timestamptz default null)
returns public.entitlements
language sql
security definer
set search_path = ''
as $$
  insert into public.entitlements as e (user_id, plan, source, starts_at, expires_at, tester_grant, updated_at)
  values (p_user_id, 'premium', 'grant', now(), p_expires_at, false, now())
  on conflict (user_id) do update
    set plan = 'premium', source = 'grant', starts_at = now(), expires_at = p_expires_at,
        tester_grant = false, updated_at = now()
  returning *;
$$;

-- ---------------------------------------------------------------------------
-- record_play_purchase: a purchase verified with the Google Play Developer API.
-- Idempotent per purchase token; a token never moves between accounts.
-- Returns 'recorded', 'already_recorded' or 'other_account'.
-- ---------------------------------------------------------------------------

create function public.record_play_purchase(
  p_user_id uuid,
  p_purchase_token text,
  p_order_id text,
  p_product_id text,
  p_amount_micros bigint,
  p_currency text,
  p_is_test boolean,
  p_acknowledged boolean,
  p_purchased_at timestamptz,
  p_raw jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.purchases;
  result text;
begin
  select * into p from public.purchases where provider_payment_id = p_purchase_token for update;

  if found and p.user_id is distinct from p_user_id then
    return 'other_account';
  end if;

  if found then
    if p.status = 'refunded' then
      return 'refunded';
    end if;
    update public.purchases
      set acknowledged = acknowledged or p_acknowledged, raw = p_raw
      where id = p.id;
    result := 'already_recorded';
  else
    insert into public.purchases (
      user_id, provider, provider_payment_id, order_id, product_id, amount_micros, currency,
      status, acknowledged, is_test, paid_at, raw
    )
    values (
      p_user_id, 'google_play', p_purchase_token, p_order_id, p_product_id, p_amount_micros, coalesce(upper(p_currency), 'PHP'),
      'paid', p_acknowledged, p_is_test, coalesce(p_purchased_at, now()), p_raw
    );
    result := 'recorded';
  end if;

  insert into public.entitlements as e (user_id, plan, source, starts_at, expires_at, tester_grant, updated_at)
  values (p_user_id, 'premium', 'purchase', now(), null, false, now())
  on conflict (user_id) do update
    set plan = 'premium', source = 'purchase', expires_at = null, tester_grant = false, updated_at = now(),
        starts_at = case when e.source = 'purchase' then e.starts_at else now() end;

  return result;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_play_refund: a voided or refunded purchase. Back to free unless
-- Premium now comes from somewhere else (a grant, another purchase).
-- Data is never deleted. Returns 'refunded', 'already_refunded' or 'unknown_purchase'.
-- ---------------------------------------------------------------------------

create function public.record_play_refund(p_purchase_token text, p_raw jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.purchases;
begin
  select * into p from public.purchases where provider_payment_id = p_purchase_token for update;
  if not found then
    return 'unknown_purchase';
  end if;
  if p.status = 'refunded' then
    return 'already_refunded';
  end if;

  update public.purchases set status = 'refunded', raw = coalesce(p_raw, raw) where id = p.id;

  if p.user_id is not null and not exists (
    select 1 from public.purchases
    where user_id = p.user_id and status = 'paid' and id <> p.id
  ) then
    update public.entitlements
      set plan = 'free', source = null, expires_at = null, updated_at = now()
      where user_id = p.user_id and source = 'purchase';
  end if;
  return 'refunded';
end;
$$;

-- ---------------------------------------------------------------------------
-- apply_tester_grant: called for the signed-in user (by premium/status). If the
-- user's verified email has a tester grant, they get Premium with its expiry.
-- Never downgrades a purchase. Returns true when a grant was applied.
-- ---------------------------------------------------------------------------

create function public.apply_tester_grant(p_user_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  g public.tester_grants;
  current public.entitlements;
begin
  select tg.* into g
  from public.tester_grants tg
  join auth.users u on lower(u.email) = tg.email
  where u.id = p_user_id and u.email_confirmed_at is not null;
  if not found then
    return false;
  end if;

  select * into current from public.entitlements where user_id = p_user_id for update;
  if found and current.plan = 'premium' and current.source = 'purchase' then
    return false;
  end if;
  if found and current.tester_grant and current.expires_at is not distinct from g.expires_at then
    return false;
  end if;

  insert into public.entitlements as e (user_id, plan, source, starts_at, expires_at, tester_grant, updated_at)
  values (p_user_id, 'premium', 'grant', now(), g.expires_at, true, now())
  on conflict (user_id) do update
    set plan = 'premium', source = 'grant', starts_at = now(), expires_at = g.expires_at,
        tester_grant = true, updated_at = now();
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- revoke_tester_grants: accounts whose tester grant row was removed go back to
-- free. Returns how many accounts changed.
-- ---------------------------------------------------------------------------

create function public.revoke_tester_grants()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.entitlements e
    set plan = 'free', source = null, expires_at = null, tester_grant = false, updated_at = now()
    where e.tester_grant
      and not exists (
        select 1 from public.tester_grants tg
        join auth.users u on lower(u.email) = tg.email
        where u.id = e.user_id and u.email_confirmed_at is not null
      );
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- revoke_test_entitlements: at production launch, optionally return accounts
-- whose only Premium is a test purchase or a tester grant to free.
-- ---------------------------------------------------------------------------

create function public.revoke_test_entitlements()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  n integer;
begin
  update public.entitlements e
    set plan = 'free', source = null, expires_at = null, tester_grant = false, updated_at = now()
    where e.plan = 'premium'
      and (
        (e.source = 'grant' and e.tester_grant)
        or (
          e.source = 'purchase'
          and not exists (
            select 1 from public.purchases p
            where p.user_id = e.user_id and p.status = 'paid' and not p.is_test
          )
        )
      );
  get diagnostics n = row_count;
  return n;
end;
$$;

-- ---------------------------------------------------------------------------
-- Access: all of the above are service role only.
-- ---------------------------------------------------------------------------

revoke execute on function public.grant_premium(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.record_play_purchase(uuid, text, text, text, bigint, text, boolean, boolean, timestamptz, jsonb) from public, anon, authenticated;
revoke execute on function public.record_play_refund(text, jsonb) from public, anon, authenticated;
revoke execute on function public.apply_tester_grant(uuid) from public, anon, authenticated;
revoke execute on function public.revoke_tester_grants() from public, anon, authenticated;
revoke execute on function public.revoke_test_entitlements() from public, anon, authenticated;

grant execute on function public.grant_premium(uuid, timestamptz) to service_role;
grant execute on function public.record_play_purchase(uuid, text, text, text, bigint, text, boolean, boolean, timestamptz, jsonb) to service_role;
grant execute on function public.record_play_refund(text, jsonb) to service_role;
grant execute on function public.apply_tester_grant(uuid) to service_role;
grant execute on function public.revoke_tester_grants() to service_role;
grant execute on function public.revoke_test_entitlements() to service_role;

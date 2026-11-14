-- Auto Budget Premium: products, entitlements and purchases.
--
-- Clients may only READ their own entitlement and purchases. Every write
-- happens in server code: start_trial() (as the signed-in user, through a
-- security-definer function with fixed rules), and the payment webhook and
-- grant_premium() using the service role.

-- ---------------------------------------------------------------------------
-- Products: the price lives here, never in the client.
-- ---------------------------------------------------------------------------

create table public.products (
  code text primary key check (code ~ '^[a-z0-9_]{1,40}$'),
  name text not null,
  -- Integer centavos.
  amount integer not null check (amount > 0),
  currency text not null default 'PHP' check (currency = 'PHP'),
  active boolean not null default true
);

insert into public.products (code, name, amount, currency, active)
values ('premium_lifetime', 'Auto Budget Premium', 39900, 'PHP', true);

alter table public.products enable row level security;
revoke all on public.products from anon, authenticated;
grant select on public.products to anon, authenticated;
create policy "Anyone can read products" on public.products for select to anon, authenticated using (true);

-- ---------------------------------------------------------------------------
-- Entitlements: one row per user who has started a trial or bought Premium.
-- No row means free with the trial still available.
-- ---------------------------------------------------------------------------

create table public.entitlements (
  user_id uuid primary key references auth.users (id) on delete cascade,
  plan text not null default 'free' check (plan in ('free', 'premium')),
  source text check (source in ('trial', 'purchase', 'grant')),
  starts_at timestamptz,
  -- Set for a trial; null means permanent.
  expires_at timestamptz,
  trial_used boolean not null default false,
  -- When the "trial ends tomorrow" email went out (sent once).
  trial_reminder_sent_at timestamptz,
  updated_at timestamptz not null default now(),
  check (plan = 'free' or source is not null),
  check (source is distinct from 'trial' or expires_at is not null)
);

-- ---------------------------------------------------------------------------
-- Purchases: one row per checkout attempt. Kept when an account is deleted
-- (user_id becomes null) because payment records may be needed for tax.
-- ---------------------------------------------------------------------------

create table public.purchases (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete set null,
  provider text not null,
  -- The provider's checkout session, set when the session is created.
  provider_checkout_id text unique,
  -- The provider's payment, set when it is paid. Unique, so a payment is processed once.
  provider_payment_id text unique,
  product_code text not null references public.products (code),
  -- Integer centavos.
  amount integer not null check (amount > 0),
  currency text not null default 'PHP',
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'refunded')),
  payment_method text,
  refunded_amount integer not null default 0 check (refunded_amount >= 0),
  paid_at timestamptz,
  receipt_sent_at timestamptz,
  created_at timestamptz not null default now(),
  -- The provider's last event about this purchase.
  raw jsonb
);

create index purchases_user_idx on public.purchases (user_id, created_at desc);

-- Webhook events already handled, so a retried delivery does nothing twice.
create table public.payment_events (
  id text primary key,
  provider text not null,
  type text not null,
  received_at timestamptz not null default now()
);

-- Failures worth investigating (bad signatures, unknown purchases, errors).
create table public.payment_webhook_log (
  id bigint generated always as identity primary key,
  provider text not null,
  event_id text,
  event_type text,
  error text not null,
  payload jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Access
-- ---------------------------------------------------------------------------

alter table public.entitlements enable row level security;
alter table public.purchases enable row level security;
alter table public.payment_events enable row level security;
alter table public.payment_webhook_log enable row level security;

revoke all on public.entitlements, public.purchases, public.payment_events, public.payment_webhook_log from anon, authenticated;
grant select on public.entitlements, public.purchases to authenticated;

create policy "Users read their own entitlement"
  on public.entitlements for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users read their own purchases"
  on public.purchases for select to authenticated
  using ((select auth.uid()) = user_id);

-- payment_events and payment_webhook_log: no policies, so only the service role reaches them.

-- ---------------------------------------------------------------------------
-- start_trial: the caller's one free 14-day trial.
-- ---------------------------------------------------------------------------

create function public.start_trial()
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

  if found and current.plan = 'premium' and current.expires_at is null then
    raise exception 'Premium is already unlocked' using errcode = 'P0001', hint = 'already_premium';
  end if;
  if found and current.trial_used then
    raise exception 'The free trial has already been used' using errcode = 'P0001', hint = 'trial_used';
  end if;

  insert into public.entitlements as e (user_id, plan, source, starts_at, expires_at, trial_used, updated_at)
  values (uid, 'premium', 'trial', now(), now() + interval '14 days', true, now())
  on conflict (user_id) do update
    set plan = 'premium', source = 'trial', starts_at = now(), expires_at = now() + interval '14 days',
        trial_used = true, trial_reminder_sent_at = null, updated_at = now()
  returning * into current;

  return current;
end;
$$;

-- ---------------------------------------------------------------------------
-- grant_premium: permanent Premium for support cases. Service role only.
-- ---------------------------------------------------------------------------

create function public.grant_premium(p_user_id uuid)
returns public.entitlements
language sql
security definer
set search_path = ''
as $$
  insert into public.entitlements as e (user_id, plan, source, starts_at, expires_at, updated_at)
  values (p_user_id, 'premium', 'grant', now(), null, now())
  on conflict (user_id) do update
    set plan = 'premium', source = 'grant', starts_at = now(), expires_at = null, updated_at = now()
  returning *;
$$;

-- ---------------------------------------------------------------------------
-- record_payment / record_refund: called by the payment webhook (service role).
-- Both are idempotent.
-- ---------------------------------------------------------------------------

create function public.record_payment(
  p_purchase_id uuid,
  p_provider_payment_id text,
  p_amount integer,
  p_currency text,
  p_payment_method text,
  p_paid_at timestamptz,
  p_raw jsonb
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.purchases;
begin
  select * into p from public.purchases where id = p_purchase_id for update;
  if not found then
    return 'unknown_purchase';
  end if;
  if p.status in ('paid', 'refunded') then
    return 'already_processed';
  end if;
  if p_amount <> p.amount or upper(p_currency) <> p.currency then
    update public.purchases set status = 'failed', raw = p_raw where id = p.id;
    return 'amount_mismatch';
  end if;

  update public.purchases
    set status = 'paid', provider_payment_id = p_provider_payment_id, payment_method = p_payment_method,
        paid_at = coalesce(p_paid_at, now()), raw = p_raw
    where id = p.id;

  if p.user_id is not null then
    insert into public.entitlements as e (user_id, plan, source, starts_at, expires_at, updated_at)
    values (p.user_id, 'premium', 'purchase', now(), null, now())
    on conflict (user_id) do update
      set plan = 'premium', source = 'purchase', starts_at = now(), expires_at = null, updated_at = now();
  end if;
  return 'paid';
end;
$$;

create function public.record_refund(p_provider_payment_id text, p_refunded_amount integer, p_raw jsonb)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  p public.purchases;
  total integer;
begin
  select * into p from public.purchases where provider_payment_id = p_provider_payment_id for update;
  if not found then
    return 'unknown_payment';
  end if;
  total := least(p.amount, p.refunded_amount + p_refunded_amount);
  if total < p.amount then
    update public.purchases set refunded_amount = total, raw = p_raw where id = p.id;
    return 'partial_refund';
  end if;
  if p.status = 'refunded' then
    return 'already_processed';
  end if;
  update public.purchases set status = 'refunded', refunded_amount = total, raw = p_raw where id = p.id;
  -- Back to free unless Premium came from a support grant. Data is never deleted.
  update public.entitlements
    set plan = 'free', source = null, expires_at = null, updated_at = now()
    where user_id = p.user_id and source = 'purchase';
  return 'refunded';
end;
$$;

revoke execute on function public.start_trial() from public, anon;
grant execute on function public.start_trial() to authenticated;
revoke execute on function public.grant_premium(uuid) from public, anon, authenticated;
revoke execute on function public.record_payment(uuid, text, integer, text, text, timestamptz, jsonb) from public, anon, authenticated;
revoke execute on function public.record_refund(text, integer, jsonb) from public, anon, authenticated;
grant execute on function public.grant_premium(uuid) to service_role;
grant execute on function public.record_payment(uuid, text, integer, text, text, timestamptz, jsonb) to service_role;
grant execute on function public.record_refund(text, integer, jsonb) to service_role;

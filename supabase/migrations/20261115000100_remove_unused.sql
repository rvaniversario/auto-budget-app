-- Remove what the move from PayMongo checkout to Google Play billing left
-- unused (docs/SPEC-V2.md). No real users yet, so nothing is kept.

-- The PayMongo webhook's event and failure tables.
drop table if exists public.payment_events;
drop table if exists public.payment_webhook_log;

-- PayMongo checkout columns. Google Play purchases use provider_payment_id
-- (the purchase token), order_id, product_id, amount_micros and currency.
alter table public.purchases
  drop column if exists provider_checkout_id,
  drop column if exists product_code,
  drop column if exists amount,
  drop column if exists payment_method,
  drop column if exists refunded_amount,
  drop column if exists receipt_sent_at;

-- Google Play purchases are pending, paid or refunded ('failed' was PayMongo's).
delete from public.purchases where status = 'failed';
alter table public.purchases drop constraint if exists purchases_status_check;
alter table public.purchases add constraint purchases_status_check check (status in ('pending', 'paid', 'refunded'));

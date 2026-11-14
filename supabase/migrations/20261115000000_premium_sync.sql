-- Sync across devices becomes a Premium feature (docs/SPEC-V2.md).
--
-- can_sync(uid) is true for an active Premium entitlement (purchase, grant or
-- unexpired trial) or for accounts marked legacy_sync: every account that had
-- synced before version 2, which keeps sync free permanently.
--
-- Enforced on the server: sync_push, sync_pull and sync_status refuse callers
-- who cannot sync, and row-level security hides synced rows from them. The
-- server copy is never deleted when sync stops, so it resumes where it left off.

alter table public.entitlements add column legacy_sync boolean not null default false;

-- Accounts that have synced at least once (any device that pushed or pulled).
insert into public.entitlements as e (user_id, plan, legacy_sync, updated_at)
select distinct d.user_id, 'free', true, now()
from public.sync_devices d
on conflict (user_id) do update set legacy_sync = true, updated_at = now();

-- ---------------------------------------------------------------------------
-- can_sync
-- ---------------------------------------------------------------------------

create function public.can_sync(p_user_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  -- A signed-in user may only ask about themselves.
  if auth.uid() is not null and p_user_id is distinct from auth.uid() then
    return false;
  end if;
  return exists (
    select 1 from public.entitlements e
    where e.user_id = p_user_id
      and (e.legacy_sync or (e.plan = 'premium' and (e.expires_at is null or e.expires_at > now())))
  );
end;
$$;

revoke execute on function public.can_sync(uuid) from public, anon;
grant execute on function public.can_sync(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- The sync functions: the caller must be signed in AND allowed to sync.
-- ---------------------------------------------------------------------------

create or replace function public.sync_require_user()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Sign in required' using errcode = '28000';
  end if;
  if not public.can_sync(uid) then
    raise exception 'Sync is part of Premium' using errcode = 'P0001', hint = 'sync_requires_premium';
  end if;
  return uid;
end;
$$;

revoke execute on function public.sync_require_user() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security: synced rows are visible only while the account can sync.
-- Writes stay revoked: only sync_push writes.
-- ---------------------------------------------------------------------------

drop policy "Users read their own sync records" on public.sync_records;
drop policy "Users read their own devices" on public.sync_devices;

create policy "Users who can sync read their own sync records"
  on public.sync_records for select to authenticated
  using ((select auth.uid()) = user_id and (select public.can_sync(auth.uid())));

create policy "Users who can sync read their own devices"
  on public.sync_devices for select to authenticated
  using ((select auth.uid()) = user_id and (select public.can_sync(auth.uid())));

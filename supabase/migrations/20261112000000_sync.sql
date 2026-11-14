-- Online backup and sync.
--
-- One generic table holds every synced record as JSON, keyed by the record's
-- collection (the client's table name) and id. Any collection a newer client
-- adds syncs without a migration, and older clients simply ignore collections
-- they don't know, so clients of different versions can share one account.
--
-- Clients never write to these tables directly. They call sync_push and
-- sync_pull (through the `sync` server function), which apply
-- last-write-wins by the record's own updatedAt.

create sequence public.sync_rev_seq;

create table public.sync_records (
  user_id uuid not null references auth.users (id) on delete cascade,
  collection text not null check (collection ~ '^[A-Za-z][A-Za-z0-9_]{0,39}$'),
  record_id text not null check (char_length(record_id) between 1 and 64),
  -- The whole record exactly as the client stores it (camelCase keys).
  data jsonb not null check (jsonb_typeof(data) = 'object' and pg_column_size(data) <= 16384),
  -- Copied from data.updatedAt / data.deletedAt for comparisons and counts.
  updated_at timestamptz not null,
  deleted_at timestamptz,
  -- Increases on every accepted write; clients pull "everything after rev N".
  rev bigint not null default nextval('public.sync_rev_seq'),
  -- The device that wrote the current version, so it can skip its own echoes.
  last_device_id text,
  server_updated_at timestamptz not null default now(),
  primary key (user_id, collection, record_id)
);

create index sync_records_user_rev_idx on public.sync_records (user_id, rev);

create table public.sync_devices (
  user_id uuid not null references auth.users (id) on delete cascade,
  device_id text not null check (char_length(device_id) between 1 and 64),
  label text not null default '' check (char_length(label) <= 60),
  first_seen_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  primary key (user_id, device_id)
);

-- ---------------------------------------------------------------------------
-- Access: a user may read only their own rows. Nobody writes directly.
-- ---------------------------------------------------------------------------

alter table public.sync_records enable row level security;
alter table public.sync_devices enable row level security;

revoke all on public.sync_records from anon, authenticated;
revoke all on public.sync_devices from anon, authenticated;
grant select on public.sync_records to authenticated;
grant select on public.sync_devices to authenticated;
revoke all on sequence public.sync_rev_seq from anon, authenticated;

create policy "Users read their own sync records"
  on public.sync_records for select to authenticated
  using ((select auth.uid()) = user_id);

create policy "Users read their own devices"
  on public.sync_devices for select to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create function public.sync_require_user()
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
  return uid;
end;
$$;

create function public.sync_touch_device(p_user_id uuid, p_device_id text, p_label text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.sync_devices (user_id, device_id, label)
  values (p_user_id, left(p_device_id, 64), left(coalesce(p_label, ''), 60))
  on conflict (user_id, device_id) do update
    set label = excluded.label, last_seen_at = now();
$$;

-- Serialises writers per user, and makes readers wait for an in-flight write,
-- so a pull never skips a rev that commits after it has read past it.
create function public.sync_lock(p_user_id uuid, p_exclusive boolean)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if p_exclusive then
    perform pg_advisory_xact_lock(hashtextextended('auto-budget-sync:' || p_user_id::text, 0));
  else
    perform pg_advisory_xact_lock_shared(hashtextextended('auto-budget-sync:' || p_user_id::text, 0));
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- sync_push: upload changed records. Last write (by record updatedAt) wins.
--   p_records: [{ "collection": "transactions", "data": { "id": ..., "updatedAt": ..., ... } }, ...]
-- Returns { "accepted": n, "ignored": n } where ignored = the server already had
-- the same or a newer version.
-- ---------------------------------------------------------------------------

create function public.sync_push(p_device_id text, p_device_label text, p_records jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.sync_require_user();
  total int;
  accepted int;
begin
  if p_records is null or jsonb_typeof(p_records) <> 'array' then
    raise exception 'records must be an array' using errcode = '22023';
  end if;
  total := jsonb_array_length(p_records);
  if total > 500 then
    raise exception 'At most 500 records per push' using errcode = '22023';
  end if;
  if p_device_id is null or char_length(p_device_id) not between 1 and 64 then
    raise exception 'device id required' using errcode = '22023';
  end if;

  perform public.sync_lock(uid, true);
  perform public.sync_touch_device(uid, p_device_id, p_device_label);

  with incoming as (
    select distinct on (r.collection, r.data ->> 'id')
      r.collection,
      r.data ->> 'id' as record_id,
      r.data,
      (r.data ->> 'updatedAt')::timestamptz as updated_at,
      (r.data ->> 'deletedAt')::timestamptz as deleted_at
    from jsonb_to_recordset(p_records) as r (collection text, data jsonb)
    where r.collection is not null
      and jsonb_typeof(r.data) = 'object'
      and r.data ->> 'id' is not null
      and r.data ->> 'updatedAt' is not null
    order by r.collection, r.data ->> 'id', (r.data ->> 'updatedAt')::timestamptz desc
  ),
  written as (
    insert into public.sync_records as s
      (user_id, collection, record_id, data, updated_at, deleted_at, last_device_id)
    select uid, i.collection, i.record_id, i.data, i.updated_at, i.deleted_at, p_device_id
    from incoming i
    on conflict (user_id, collection, record_id) do update
      set data = excluded.data,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at,
          last_device_id = excluded.last_device_id,
          rev = nextval('public.sync_rev_seq'),
          server_updated_at = now()
      where s.updated_at < excluded.updated_at
    returning 1
  )
  select count(*) into accepted from written;

  return jsonb_build_object('accepted', accepted, 'ignored', total - accepted);
end;
$$;

-- ---------------------------------------------------------------------------
-- sync_pull: download records changed after p_since (a rev from a previous
-- pull; 0 for everything). Records this device wrote itself are left out when
-- p_since > 0, since the device already has them.
-- Returns { "records": [{ "collection", "data" }], "cursor": rev, "hasMore": bool }
-- ---------------------------------------------------------------------------

create function public.sync_pull(p_device_id text, p_device_label text, p_since bigint, p_limit int default 500)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := public.sync_require_user();
  since bigint := greatest(coalesce(p_since, 0), 0);
  lim int := least(greatest(coalesce(p_limit, 500), 1), 1000);
  page_count int;
  next_cursor bigint;
  records jsonb;
begin
  if p_device_id is null or char_length(p_device_id) not between 1 and 64 then
    raise exception 'device id required' using errcode = '22023';
  end if;

  perform public.sync_lock(uid, false);
  perform public.sync_touch_device(uid, p_device_id, p_device_label);

  with page as (
    select s.collection, s.data, s.rev, s.last_device_id
    from public.sync_records s
    where s.user_id = uid and s.rev > since
    order by s.rev
    limit lim
  )
  select
    count(*),
    coalesce(max(rev), since),
    coalesce(
      jsonb_agg(jsonb_build_object('collection', collection, 'data', data) order by rev)
        filter (where since = 0 or last_device_id is distinct from p_device_id),
      '[]'::jsonb
    )
  into page_count, next_cursor, records
  from page;

  return jsonb_build_object('records', records, 'cursor', next_cursor, 'hasMore', page_count = lim);
end;
$$;

-- ---------------------------------------------------------------------------
-- sync_status: what is saved online, for the Account and backup screen.
-- Returns { "counts": { collection: liveRecords }, "devices": [...], "cursor": latest rev }
-- ---------------------------------------------------------------------------

create function public.sync_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  uid uuid := public.sync_require_user();
  counts jsonb;
  devices jsonb;
  latest bigint;
begin
  select coalesce(jsonb_object_agg(collection, n), '{}'::jsonb) into counts
  from (
    select collection, count(*) as n
    from public.sync_records
    where user_id = uid and deleted_at is null
    group by collection
  ) c;

  select coalesce(jsonb_agg(jsonb_build_object('id', device_id, 'label', label, 'lastSeenAt', last_seen_at) order by last_seen_at desc), '[]'::jsonb)
  into devices
  from public.sync_devices
  where user_id = uid;

  select coalesce(max(rev), 0) into latest from public.sync_records where user_id = uid;

  return jsonb_build_object('counts', counts, 'devices', devices, 'cursor', latest);
end;
$$;

-- Only signed-in users may call the public functions; helpers are internal.
revoke execute on function public.sync_require_user() from public, anon, authenticated;
revoke execute on function public.sync_touch_device(uuid, text, text) from public, anon, authenticated;
revoke execute on function public.sync_lock(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.sync_push(text, text, jsonb) from public, anon;
revoke execute on function public.sync_pull(text, text, bigint, int) from public, anon;
revoke execute on function public.sync_status() from public, anon;
grant execute on function public.sync_push(text, text, jsonb) to authenticated;
grant execute on function public.sync_pull(text, text, bigint, int) to authenticated;
grant execute on function public.sync_status() to authenticated;

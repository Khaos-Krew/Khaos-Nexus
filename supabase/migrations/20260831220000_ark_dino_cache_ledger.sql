begin;

create table if not exists public.ark_dino_cache_purchases (
  cache_id text primary key,
  discord_id text not null,
  eos_id text not null,
  cache_type text not null,
  cache_name text not null,
  source text not null default 'SHOP',
  cost numeric(18,2) not null default 0 check (cost >= 0),
  species_id text not null,
  species_name text not null,
  variant text not null check (variant in ('Normal','X','S')),
  blueprint_path text not null,
  level integer not null check (level > 0),
  sex text not null check (sex in ('Male','Female')),
  announce boolean not null default false,
  eligible_maps jsonb not null default '[]'::jsonb,
  status text not null default 'AWAITING_LOGIN' check (status in (
    'ROLLING','AWAITING_LOGIN','DELIVERY_LOCKED','DELIVERING','DELIVERED','DELIVERY_FAILED','DELIVERY_UNKNOWN'
  )),
  purchase_metadata jsonb not null default '{}'::jsonb,
  delivery_map text,
  delivery_response text,
  delivery_error text,
  delivery_attempts integer not null default 0 check (delivery_attempts >= 0),
  locked_at timestamptz,
  purchased_at timestamptz not null default now(),
  delivered_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists ark_dino_cache_pending_idx
  on public.ark_dino_cache_purchases (status, purchased_at)
  where status = 'AWAITING_LOGIN';

create index if not exists ark_dino_cache_eos_pending_idx
  on public.ark_dino_cache_purchases (eos_id, status);

alter table public.ark_dino_cache_purchases enable row level security;

-- Persistent per-EOS anti-spam gate. EOS is authoritative so a player cannot
-- bypass the cooldown through another Discord session/account.
create table if not exists public.ark_dino_cache_cooldowns (
  eos_id text primary key,
  next_allowed_at timestamptz not null,
  updated_at timestamptz not null default now()
);

alter table public.ark_dino_cache_cooldowns enable row level security;

-- Sentinel should use a server-side service role. No anon/authenticated policies are
-- intentionally created for the reward ledger or cooldown table.

create or replace function public.claim_ark_dino_cache_cooldown(
  p_eos_id text,
  p_cooldown_seconds integer
)
returns table (
  allowed boolean,
  retry_after_seconds integer,
  next_allowed_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_next timestamptz;
begin
  if nullif(trim(p_eos_id), '') is null then
    raise exception 'EOS ID is required';
  end if;
  if p_cooldown_seconds is null or p_cooldown_seconds < 1 or p_cooldown_seconds > 3600 then
    raise exception 'Cooldown seconds must be between 1 and 3600';
  end if;

  insert into public.ark_dino_cache_cooldowns (eos_id, next_allowed_at, updated_at)
  values (trim(p_eos_id), v_now + make_interval(secs => p_cooldown_seconds), v_now)
  on conflict (eos_id) do update
     set next_allowed_at = excluded.next_allowed_at,
         updated_at = v_now
   where public.ark_dino_cache_cooldowns.next_allowed_at <= v_now
  returning public.ark_dino_cache_cooldowns.next_allowed_at into v_next;

  if found then
    return query select true, 0, v_next;
    return;
  end if;

  select c.next_allowed_at
    into v_next
    from public.ark_dino_cache_cooldowns c
   where c.eos_id = trim(p_eos_id);

  return query
  select false,
         greatest(1, ceil(extract(epoch from (v_next - v_now)))::integer),
         v_next;
end;
$$;

revoke all on function public.claim_ark_dino_cache_cooldown(text, integer) from public;
revoke all on function public.claim_ark_dino_cache_cooldown(text, integer) from anon;
revoke all on function public.claim_ark_dino_cache_cooldown(text, integer) from authenticated;
grant execute on function public.claim_ark_dino_cache_cooldown(text, integer) to service_role;

create or replace function public.lock_ark_dino_cache_delivery(p_cache_id text)
returns setof public.ark_dino_cache_purchases
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update public.ark_dino_cache_purchases
     set status = 'DELIVERY_LOCKED',
         locked_at = now(),
         delivery_attempts = delivery_attempts + 1,
         updated_at = now()
   where cache_id = p_cache_id
     and status = 'AWAITING_LOGIN'
  returning *;
end;
$$;

revoke all on function public.lock_ark_dino_cache_delivery(text) from public;
revoke all on function public.lock_ark_dino_cache_delivery(text) from anon;
revoke all on function public.lock_ark_dino_cache_delivery(text) from authenticated;
grant execute on function public.lock_ark_dino_cache_delivery(text) to service_role;

create or replace function public.touch_ark_dino_cache_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists ark_dino_cache_updated_at on public.ark_dino_cache_purchases;
create trigger ark_dino_cache_updated_at
before update on public.ark_dino_cache_purchases
for each row execute function public.touch_ark_dino_cache_updated_at();

commit;

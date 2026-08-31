begin;

create table if not exists public.ark_account_links (
  discord_id text primary key,
  eos_id text not null unique,
  player_name text,
  verified boolean not null default false,
  linked_at timestamptz not null default now(),
  verified_at timestamptz
);

alter table public.ark_account_links add column if not exists player_name text;
alter table public.ark_account_links add column if not exists verified boolean not null default false;
alter table public.ark_account_links add column if not exists linked_at timestamptz not null default now();
alter table public.ark_account_links add column if not exists verified_at timestamptz;

create table if not exists public.nexus_spin_cooldowns (
  eos_id text primary key,
  next_allowed_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.nexus_spin_attempts (
  spin_id text primary key,
  discord_id text not null,
  eos_id text not null,
  spin_source text not null default 'FREE' check (spin_source in ('FREE','POINTS')),
  spin_cost bigint not null default 0 check (spin_cost >= 0),
  reward_type text not null check (reward_type in ('points','resource','cache_token')),
  reward_key text not null,
  reward_label text not null,
  resource_key text,
  amount bigint,
  tier text not null,
  weight integer not null check (weight > 0),
  status text not null default 'ROLLED' check (status in (
    'ROLLED','PENDING_POINTS','PENDING_RESOURCE','PENDING_TOKEN','REWARDING','REWARDED','DELIVERY_UNKNOWN'
  )),
  reward_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  rewarded_at timestamptz,
  constraint nexus_spin_cost_matches_source check (
    (spin_source = 'FREE' and spin_cost = 0) or
    (spin_source = 'POINTS' and spin_cost > 0)
  )
);

alter table public.nexus_spin_attempts add column if not exists spin_source text not null default 'FREE';
alter table public.nexus_spin_attempts add column if not exists spin_cost bigint not null default 0;

create index if not exists nexus_spin_attempts_discord_status_idx
  on public.nexus_spin_attempts (discord_id, status, created_at);
create index if not exists nexus_spin_attempts_eos_created_idx
  on public.nexus_spin_attempts (eos_id, created_at desc);
create index if not exists nexus_spin_attempts_source_created_idx
  on public.nexus_spin_attempts (spin_source, created_at desc);

create table if not exists public.ark_cache_tokens (
  token_id uuid primary key default gen_random_uuid(),
  discord_id text not null,
  eos_id text not null,
  source_spin_id text not null unique references public.nexus_spin_attempts(spin_id) on delete restrict,
  token_type text not null default 'DINO_CACHE',
  status text not null default 'ACTIVE' check (status in ('ACTIVE','RESERVED','REDEEMED','VOID')),
  created_at timestamptz not null default now(),
  redeemed_at timestamptz,
  redemption_metadata jsonb not null default '{}'::jsonb
);

create index if not exists ark_cache_tokens_owner_status_idx
  on public.ark_cache_tokens (discord_id, eos_id, status, created_at);

create or replace function public.create_nexus_spin_attempt(
  p_spin_id text,
  p_discord_id text,
  p_eos_id text,
  p_reward_type text,
  p_reward_key text,
  p_reward_label text,
  p_resource_key text,
  p_amount bigint,
  p_tier text,
  p_weight integer,
  p_created_at timestamptz,
  p_cooldown_seconds integer
)
returns table (
  allowed boolean,
  retry_after_seconds bigint,
  next_allowed_at timestamptz,
  spin_id text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_current timestamptz;
  v_next timestamptz;
begin
  if coalesce(trim(p_spin_id), '') = '' or coalesce(trim(p_discord_id), '') = '' or coalesce(trim(p_eos_id), '') = '' then
    raise exception 'spin_id, discord_id, and eos_id are required';
  end if;
  if p_cooldown_seconds is null or p_cooldown_seconds < 1 then
    raise exception 'cooldown must be at least one second';
  end if;

  insert into public.nexus_spin_cooldowns (eos_id, next_allowed_at, updated_at)
  values (p_eos_id, v_now, v_now)
  on conflict (eos_id) do nothing;

  select c.next_allowed_at
    into v_current
    from public.nexus_spin_cooldowns c
   where c.eos_id = p_eos_id
   for update;

  if v_current > v_now then
    return query select false,
      greatest(0, ceil(extract(epoch from (v_current - v_now)))::bigint),
      v_current,
      null::text;
    return;
  end if;

  v_next := v_now + make_interval(secs => p_cooldown_seconds);
  update public.nexus_spin_cooldowns
     set next_allowed_at = v_next,
         updated_at = v_now
   where eos_id = p_eos_id;

  insert into public.nexus_spin_attempts (
    spin_id, discord_id, eos_id, spin_source, spin_cost,
    reward_type, reward_key, reward_label, resource_key, amount,
    tier, weight, status, created_at
  ) values (
    p_spin_id, p_discord_id, p_eos_id, 'FREE', 0,
    p_reward_type, p_reward_key, p_reward_label, p_resource_key, p_amount,
    p_tier, p_weight, 'ROLLED', coalesce(p_created_at, v_now)
  );

  return query select true, 0::bigint, v_next, p_spin_id;
end;
$$;

create or replace function public.lock_nexus_spin_reward(
  p_spin_id text,
  p_expected_status text
)
returns setof public.nexus_spin_attempts
language sql
security definer
set search_path = public
as $$
  update public.nexus_spin_attempts
     set status = 'REWARDING'
   where spin_id = p_spin_id
     and status = p_expected_status
  returning *;
$$;

alter table public.ark_account_links enable row level security;
alter table public.nexus_spin_cooldowns enable row level security;
alter table public.nexus_spin_attempts enable row level security;
alter table public.ark_cache_tokens enable row level security;

revoke all on function public.create_nexus_spin_attempt(text,text,text,text,text,text,text,bigint,text,integer,timestamptz,integer) from public, anon, authenticated;
revoke all on function public.lock_nexus_spin_reward(text,text) from public, anon, authenticated;
grant execute on function public.create_nexus_spin_attempt(text,text,text,text,text,text,text,bigint,text,integer,timestamptz,integer) to service_role;
grant execute on function public.lock_nexus_spin_reward(text,text) to service_role;

commit;

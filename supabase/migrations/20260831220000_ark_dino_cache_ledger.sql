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

-- Sentinel should use a server-side service role. No anon/authenticated policies are
-- intentionally created for this immutable reward ledger.

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

-- Khaos Nexus D&D Discord Campaign Integration
-- Verified baseline on 2026-07-31: the target project had no public application tables or migrations.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table public.nexus_tenants (
  id uuid primary key default extensions.gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  owner_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.nexus_tenant_members (
  tenant_id uuid not null references public.nexus_tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','member','viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create table public.discord_registered_apps (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.nexus_tenants(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete restrict,
  application_id text not null check (application_id ~ '^[0-9]{5,25}$'),
  bot_user_id text check (bot_user_id is null or bot_user_id ~ '^[0-9]{5,25}$'),
  display_name text not null check (char_length(display_name) between 1 and 120),
  enabled boolean not null default true,
  modules text[] not null default array[]::text[],
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, application_id)
);

create table public.discord_app_managers (
  app_id uuid not null references public.discord_registered_apps(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (app_id, user_id)
);

create table public.discord_role_mappings (
  id uuid primary key default extensions.gen_random_uuid(),
  app_id uuid not null references public.discord_registered_apps(id) on delete cascade,
  guild_id text not null check (guild_id ~ '^[0-9]{5,25}$'),
  discord_role_id text not null check (discord_role_id ~ '^[0-9]{5,25}$'),
  nexus_role text not null check (nexus_role in ('viewer','operator')),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (app_id, guild_id, discord_role_id)
);
comment on table public.discord_role_mappings is 'Discord role mappings cannot grant Nexus owner or administrator privileges.';

create table public.dnd_campaigns (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.nexus_tenants(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 120),
  description text not null default '',
  status text not null default 'planning' check (status in ('planning','active','paused','completed','archived')),
  ruleset text not null default '5e_2024',
  owner_user_id uuid not null references auth.users(id) on delete restrict,
  current_location text not null default '',
  active_quest_id uuid,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.dnd_campaign_members (
  id uuid primary key default extensions.gen_random_uuid(),
  campaign_id uuid not null references public.dnd_campaigns(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  discord_user_id text check (discord_user_id is null or discord_user_id ~ '^[0-9]{5,25}$'),
  display_name text not null default '',
  role text not null check (role in ('admin','dm','assistant_dm','player','viewer')),
  capabilities text[] not null default array[]::text[],
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_id is not null or discord_user_id is not null)
);
create unique index dnd_campaign_members_user_unique on public.dnd_campaign_members(campaign_id, user_id) where user_id is not null and active;
create unique index dnd_campaign_members_discord_unique on public.dnd_campaign_members(campaign_id, discord_user_id) where discord_user_id is not null and active;
create unique index dnd_campaign_owner_unique on public.dnd_campaign_members(campaign_id) where role = 'dm' and 'campaign_owner' = any(capabilities) and active;

create table public.dnd_sources (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid references public.nexus_tenants(id) on delete cascade,
  name text not null,
  ruleset text not null default '',
  source_version text not null default '',
  license_type text not null check (license_type in ('srd_cc_by','user_authored','user_supplied_private','metadata_only','external_link','partner_api','unknown_restricted')),
  license_reference text not null default '',
  attribution_text text not null default '',
  external_reference_url text not null default '',
  is_full_text_allowed boolean not null default false,
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.dnd_campaign_sources (
  id uuid primary key default extensions.gen_random_uuid(),
  campaign_id uuid not null references public.dnd_campaigns(id) on delete cascade,
  source_id uuid not null references public.dnd_sources(id) on delete restrict,
  enabled boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, source_id)
);

create table public.dnd_content_entries (
  id uuid primary key default extensions.gen_random_uuid(),
  source_id uuid references public.dnd_sources(id) on delete restrict,
  content_type text not null,
  name text not null,
  summary text not null default '',
  full_text text,
  content_origin text not null default 'metadata_only',
  content_hash text not null default '',
  active boolean not null default true,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.dnd_enforce_content_license()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare allowed boolean;
begin
  if new.full_text is null then return new; end if;
  select s.is_full_text_allowed into allowed from public.dnd_sources s where s.id = new.source_id;
  if coalesce(allowed, false) is not true then
    raise exception 'Full text is not permitted for this source' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger dnd_content_license_guard
before insert or update of source_id, full_text on public.dnd_content_entries
for each row execute function public.dnd_enforce_content_license();

create table public.dnd_homebrew (
  id uuid primary key default extensions.gen_random_uuid(),
  entry_id uuid not null default extensions.gen_random_uuid(),
  campaign_id uuid not null references public.dnd_campaigns(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete restrict,
  content_type text not null,
  name text not null,
  status text not null default 'draft' check (status in ('draft','submitted','under_review','changes_requested','approved','rejected','retired')),
  revision integer not null default 1 check (revision > 0),
  body jsonb not null default '{}'::jsonb,
  submitted_snapshot jsonb,
  approved_by uuid references auth.users(id) on delete restrict,
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, entry_id, revision)
);

create table public.dnd_characters (
  id uuid primary key default extensions.gen_random_uuid(),
  campaign_id uuid not null references public.dnd_campaigns(id) on delete cascade,
  owner_user_id uuid references auth.users(id) on delete set null,
  discord_user_id text check (discord_user_id is null or discord_user_id ~ '^[0-9]{5,25}$'),
  name text not null,
  portrait_url text not null default '',
  level integer not null default 1 check (level between 0 and 30),
  class_name text not null default '',
  hp integer not null default 0,
  max_hp integer not null default 0,
  armor_class integer not null default 0,
  conditions text[] not null default array[]::text[],
  inspiration boolean not null default false,
  exhaustion integer not null default 0 check (exhaustion between 0 and 6),
  status text not null default 'active' check (status in ('active','backup','deceased','retired','inactive')),
  active_quest_id uuid,
  initiative_modifier integer not null default 0,
  ability_modifiers jsonb not null default '{}'::jsonb,
  selected boolean not null default false,
  revision integer not null default 1,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index dnd_character_selected_user_unique on public.dnd_characters(campaign_id, owner_user_id) where selected and owner_user_id is not null;
create unique index dnd_character_selected_discord_unique on public.dnd_characters(campaign_id, discord_user_id) where selected and discord_user_id is not null;

create table public.dnd_quests (
  id uuid primary key default extensions.gen_random_uuid(),
  campaign_id uuid not null references public.dnd_campaigns(id) on delete cascade,
  title text not null,
  summary text not null default '',
  gm_notes text not null default '',
  status text not null default 'draft' check (status in ('draft','available','active','completed','failed','abandoned','archived')),
  visible_to_players boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.dnd_campaigns add constraint dnd_campaign_active_quest_fk foreign key (active_quest_id) references public.dnd_quests(id) on delete set null;
alter table public.dnd_characters add constraint dnd_character_active_quest_fk foreign key (active_quest_id) references public.dnd_quests(id) on delete set null;

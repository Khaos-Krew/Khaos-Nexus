create table public.dnd_npcs (
  id uuid primary key default extensions.gen_random_uuid(),
  campaign_id uuid not null references public.dnd_campaigns(id) on delete cascade,
  name text not null,
  public_summary text not null default '',
  gm_notes text not null default '',
  revealed boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.dnd_locations (
  id uuid primary key default extensions.gen_random_uuid(),
  campaign_id uuid not null references public.dnd_campaigns(id) on delete cascade,
  name text not null,
  public_summary text not null default '',
  gm_notes text not null default '',
  revealed boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.dnd_factions (
  id uuid primary key default extensions.gen_random_uuid(),
  campaign_id uuid not null references public.dnd_campaigns(id) on delete cascade,
  name text not null,
  public_summary text not null default '',
  gm_notes text not null default '',
  revealed boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.dnd_loot (
  id uuid primary key default extensions.gen_random_uuid(),
  campaign_id uuid not null references public.dnd_campaigns(id) on delete cascade,
  name text not null,
  quantity numeric not null default 1,
  status text not null default 'available',
  gm_only boolean not null default false,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.dnd_sessions (
  id uuid primary key default extensions.gen_random_uuid(),
  campaign_id uuid not null references public.dnd_campaigns(id) on delete cascade,
  title text not null,
  status text not null default 'planned' check (status in ('planned','active','completed','cancelled')),
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text not null default 'UTC',
  recap_draft text not null default '',
  recap_approved_by uuid references auth.users(id) on delete restrict,
  recap_approved_at timestamptz,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index dnd_sessions_one_active_per_campaign on public.dnd_sessions(campaign_id) where status = 'active';

create table public.dnd_session_attendance (
  id uuid primary key default extensions.gen_random_uuid(),
  session_id uuid not null references public.dnd_sessions(id) on delete cascade,
  campaign_id uuid not null references public.dnd_campaigns(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  discord_user_id text check (discord_user_id is null or discord_user_id ~ '^[0-9]{5,25}$'),
  status text not null check (status in ('attending','maybe','unavailable','late')),
  note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (user_id is not null or discord_user_id is not null)
);
create unique index dnd_attendance_user_unique on public.dnd_session_attendance(session_id, user_id) where user_id is not null;
create unique index dnd_attendance_discord_unique on public.dnd_session_attendance(session_id, discord_user_id) where discord_user_id is not null;

create table public.dnd_calendar_events (
  id uuid primary key default extensions.gen_random_uuid(),
  campaign_id uuid not null references public.dnd_campaigns(id) on delete cascade,
  session_id uuid references public.dnd_sessions(id) on delete set null,
  title text not null,
  starts_at timestamptz not null,
  ends_at timestamptz,
  timezone text not null default 'UTC',
  visibility text not null default 'campaign' check (visibility in ('campaign','dm_only')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.dnd_encounters (
  id uuid primary key default extensions.gen_random_uuid(),
  campaign_id uuid not null references public.dnd_campaigns(id) on delete cascade,
  session_id uuid references public.dnd_sessions(id) on delete set null,
  name text not null,
  status text not null default 'draft' check (status in ('draft','ready','active','paused','completed','archived')),
  round integer not null default 1 check (round > 0),
  current_turn_index integer not null default 0 check (current_turn_index >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.dnd_encounter_combatants (
  id uuid primary key default extensions.gen_random_uuid(),
  encounter_id uuid not null references public.dnd_encounters(id) on delete cascade,
  campaign_id uuid not null references public.dnd_campaigns(id) on delete cascade,
  character_id uuid references public.dnd_characters(id) on delete set null,
  npc_id uuid references public.dnd_npcs(id) on delete set null,
  discord_user_id text check (discord_user_id is null or discord_user_id ~ '^[0-9]{5,25}$'),
  name_snapshot text not null,
  initiative integer not null default 0,
  dexterity integer not null default 0,
  hp integer,
  max_hp integer,
  conditions text[] not null default array[]::text[],
  hidden boolean not null default false,
  active boolean not null default true,
  joined_at timestamptz not null default now(),
  removed_at timestamptz,
  metadata jsonb not null default '{}'::jsonb
);

create table public.dnd_dice_rolls (
  id uuid primary key default extensions.gen_random_uuid(),
  campaign_id uuid not null references public.dnd_campaigns(id) on delete cascade,
  session_id uuid references public.dnd_sessions(id) on delete set null,
  character_id uuid references public.dnd_characters(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  discord_user_id text check (discord_user_id is null or discord_user_id ~ '^[0-9]{5,25}$'),
  registered_app_id uuid references public.discord_registered_apps(id) on delete set null,
  guild_id text check (guild_id is null or guild_id ~ '^[0-9]{5,25}$'),
  channel_id text check (channel_id is null or channel_id ~ '^[0-9]{5,25}$'),
  interaction_id text check (interaction_id is null or interaction_id ~ '^[0-9]{5,25}$'),
  expression text not null,
  normalized_expression text not null,
  individual_rolls integer[] not null,
  kept_indexes integer[] not null default array[]::integer[],
  modifier integer not null default 0,
  total integer not null,
  privacy text not null default 'public' check (privacy in ('public','dm_only','blind')),
  delivered_to_dm boolean not null default false,
  parser_version text not null default '1',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create unique index dnd_dice_roll_interaction_unique on public.dnd_dice_rolls(registered_app_id, interaction_id) where interaction_id is not null;

create table public.dnd_discord_bindings (
  id uuid primary key default extensions.gen_random_uuid(),
  campaign_id uuid not null references public.dnd_campaigns(id) on delete cascade,
  registered_app_id uuid not null references public.discord_registered_apps(id) on delete cascade,
  guild_id text not null check (guild_id ~ '^[0-9]{5,25}$'),
  resource_type text not null check (resource_type in ('channel','thread','forum_post')),
  resource_id text not null check (resource_id ~ '^[0-9]{5,25}$'),
  parent_channel_id text check (parent_channel_id is null or parent_channel_id ~ '^[0-9]{5,25}$'),
  display_name text not null default '',
  purpose text not null check (purpose in ('main','dm_private','dice_log','character_chat','session_notes','loot','announcements','voice')),
  is_primary boolean not null default false,
  active boolean not null default true,
  creator_id uuid not null references auth.users(id) on delete restrict,
  metadata jsonb not null default '{}'::jsonb,
  verified_at timestamptz,
  last_error_code text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index dnd_binding_campaign_resource_unique on public.dnd_discord_bindings(campaign_id, registered_app_id, guild_id, resource_type, resource_id, purpose) where active;
create unique index dnd_binding_primary_main_unique on public.dnd_discord_bindings(campaign_id, registered_app_id, guild_id) where active and is_primary and purpose = 'main';

create table public.dnd_bot_campaign_grants (
  id uuid primary key default extensions.gen_random_uuid(),
  campaign_id uuid not null references public.dnd_campaigns(id) on delete cascade,
  registered_app_id uuid not null references public.discord_registered_apps(id) on delete cascade,
  guild_id text not null check (guild_id ~ '^[0-9]{5,25}$'),
  scopes text[] not null default array[]::text[],
  active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, registered_app_id, guild_id)
);

create table public.dnd_shared_channel_contexts (
  id uuid primary key default extensions.gen_random_uuid(),
  registered_app_id uuid not null references public.discord_registered_apps(id) on delete cascade,
  guild_id text not null check (guild_id ~ '^[0-9]{5,25}$'),
  channel_id text not null check (channel_id ~ '^[0-9]{5,25}$'),
  campaign_id uuid not null references public.dnd_campaigns(id) on delete cascade,
  selected_by uuid not null references auth.users(id) on delete restrict,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (registered_app_id, guild_id, channel_id)
);

create table public.dnd_campaign_panels (
  id uuid primary key default extensions.gen_random_uuid(),
  binding_id uuid not null references public.dnd_discord_bindings(id) on delete cascade,
  message_id text check (message_id is null or message_id ~ '^[0-9]{5,25}$'),
  content_hash text not null default '',
  last_refreshed_at timestamptz,
  last_error_code text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (binding_id)
);

create table public.dnd_audit_log (
  id uuid primary key default extensions.gen_random_uuid(),
  tenant_id uuid not null references public.nexus_tenants(id) on delete cascade,
  campaign_id uuid references public.dnd_campaigns(id) on delete set null,
  actor_user_id uuid references auth.users(id) on delete set null,
  registered_app_id uuid references public.discord_registered_apps(id) on delete set null,
  guild_id text,
  action text not null,
  outcome text not null default 'success',
  target_type text not null default '',
  target_id text not null default '',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index dnd_campaigns_tenant_idx on public.dnd_campaigns(tenant_id);
create index dnd_members_campaign_idx on public.dnd_campaign_members(campaign_id);
create index dnd_bindings_lookup_idx on public.dnd_discord_bindings(registered_app_id, guild_id, resource_id) where active;
create index dnd_context_lookup_idx on public.dnd_shared_channel_contexts(registered_app_id, guild_id, channel_id) where active;
create index dnd_sessions_campaign_idx on public.dnd_sessions(campaign_id, starts_at);
create index dnd_rolls_campaign_idx on public.dnd_dice_rolls(campaign_id, created_at desc);
create index dnd_audit_campaign_idx on public.dnd_audit_log(campaign_id, created_at desc);

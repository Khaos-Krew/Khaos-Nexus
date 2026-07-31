-- Keep privileged authorization helpers out of the exposed public API schema.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated, service_role;

create or replace function private.nexus_tenant_role(p_tenant_id uuid)
returns text
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select case
    when t.owner_id = auth.uid() then 'owner'
    else (select m.role from public.nexus_tenant_members m where m.tenant_id = p_tenant_id and m.user_id = auth.uid())
  end
  from public.nexus_tenants t where t.id = p_tenant_id;
$$;

create or replace function private.dnd_campaign_role(p_campaign_id uuid)
returns text
language sql
stable
security definer
set search_path = public, private, pg_temp
as $$
  select case
    when c.owner_user_id = auth.uid() then 'dm'
    when private.nexus_tenant_role(c.tenant_id) in ('owner','admin') then 'admin'
    else (select m.role from public.dnd_campaign_members m where m.campaign_id = p_campaign_id and m.user_id = auth.uid() and m.active limit 1)
  end
  from public.dnd_campaigns c where c.id = p_campaign_id;
$$;

create or replace function private.dnd_can_view_campaign(p_campaign_id uuid)
returns boolean language sql stable security definer set search_path = public, private, pg_temp
as $$ select private.dnd_campaign_role(p_campaign_id) is not null $$;

create or replace function private.dnd_can_manage_campaign(p_campaign_id uuid)
returns boolean language sql stable security definer set search_path = public, private, pg_temp
as $$ select private.dnd_campaign_role(p_campaign_id) in ('admin','dm','assistant_dm') $$;

create or replace function private.dnd_user_can_manage_app(p_app_id uuid)
returns boolean language sql stable security definer set search_path = public, private, pg_temp
as $$
  select exists (
    select 1 from public.discord_registered_apps a
    where a.id = p_app_id and (
      a.owner_id = auth.uid() or
      private.nexus_tenant_role(a.tenant_id) in ('owner','admin') or
      exists (select 1 from public.discord_app_managers m where m.app_id = a.id and m.user_id = auth.uid())
    )
  )
$$;

create or replace function private.dnd_get_public_bindings(p_campaign_id uuid)
returns table (id uuid, campaign_id uuid, registered_app_id uuid, guild_id text, resource_type text, resource_id text, display_name text, purpose text, is_primary boolean, active boolean, verified_at timestamptz, last_error_code text)
language sql stable security definer set search_path = public, private, pg_temp
as $$
  select b.id, b.campaign_id, b.registered_app_id, b.guild_id, b.resource_type, b.resource_id, b.display_name, b.purpose, b.is_primary, b.active, b.verified_at, b.last_error_code
  from public.dnd_discord_bindings b
  where b.campaign_id = p_campaign_id and b.active and b.purpose <> 'dm_private' and private.dnd_can_view_campaign(p_campaign_id)
$$;

revoke all on all functions in schema private from public, anon;
grant execute on function private.nexus_tenant_role(uuid) to authenticated, service_role;
grant execute on function private.dnd_campaign_role(uuid) to authenticated, service_role;
grant execute on function private.dnd_can_view_campaign(uuid) to authenticated, service_role;
grant execute on function private.dnd_can_manage_campaign(uuid) to authenticated, service_role;
grant execute on function private.dnd_user_can_manage_app(uuid) to authenticated, service_role;
grant execute on function private.dnd_get_public_bindings(uuid) to authenticated, service_role;

-- Public wrappers are invokers and expose only the caller's own authorization result.
create or replace function public.nexus_tenant_role(p_tenant_id uuid)
returns text language sql stable security invoker set search_path = public, private, pg_temp
as $$ select private.nexus_tenant_role(p_tenant_id) $$;

create or replace function public.dnd_campaign_role(p_campaign_id uuid)
returns text language sql stable security invoker set search_path = public, private, pg_temp
as $$ select private.dnd_campaign_role(p_campaign_id) $$;

create or replace function public.dnd_can_view_campaign(p_campaign_id uuid)
returns boolean language sql stable security invoker set search_path = public, private, pg_temp
as $$ select private.dnd_can_view_campaign(p_campaign_id) $$;

create or replace function public.dnd_can_manage_campaign(p_campaign_id uuid)
returns boolean language sql stable security invoker set search_path = public, private, pg_temp
as $$ select private.dnd_can_manage_campaign(p_campaign_id) $$;

create or replace function public.dnd_user_can_manage_app(p_app_id uuid)
returns boolean language sql stable security invoker set search_path = public, private, pg_temp
as $$ select private.dnd_user_can_manage_app(p_app_id) $$;

create or replace function public.dnd_get_public_bindings(p_campaign_id uuid)
returns table (id uuid, campaign_id uuid, registered_app_id uuid, guild_id text, resource_type text, resource_id text, display_name text, purpose text, is_primary boolean, active boolean, verified_at timestamptz, last_error_code text)
language sql stable security invoker set search_path = public, private, pg_temp
as $$ select * from private.dnd_get_public_bindings(p_campaign_id) $$;

revoke all on function public.nexus_tenant_role(uuid) from public, anon;
revoke all on function public.dnd_campaign_role(uuid) from public, anon;
revoke all on function public.dnd_can_view_campaign(uuid) from public, anon;
revoke all on function public.dnd_can_manage_campaign(uuid) from public, anon;
revoke all on function public.dnd_user_can_manage_app(uuid) from public, anon;
revoke all on function public.dnd_get_public_bindings(uuid) from public, anon;
grant execute on function public.nexus_tenant_role(uuid) to authenticated, service_role;
grant execute on function public.dnd_campaign_role(uuid) to authenticated, service_role;
grant execute on function public.dnd_can_view_campaign(uuid) to authenticated, service_role;
grant execute on function public.dnd_can_manage_campaign(uuid) to authenticated, service_role;
grant execute on function public.dnd_user_can_manage_app(uuid) to authenticated, service_role;
grant execute on function public.dnd_get_public_bindings(uuid) to authenticated, service_role;

-- This event trigger is invoked by PostgreSQL, never by API callers.
revoke all on function public.rls_auto_enable() from public, anon, authenticated;

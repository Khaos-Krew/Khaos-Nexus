-- Restrict mixed public/private rows, protect campaign ownership, and expose a safe player-facing campaign state.

create or replace function public.dnd_protect_campaign_identity()
returns trigger
language plpgsql
security invoker
set search_path = public, private, pg_temp
as $$
begin
  if new.tenant_id is distinct from old.tenant_id then
    if auth.role() <> 'service_role' then
      raise exception 'Campaign tenant cannot be changed' using errcode = '42501';
    end if;
  end if;

  if new.owner_user_id is distinct from old.owner_user_id then
    if auth.role() <> 'service_role'
      and old.owner_user_id is distinct from auth.uid()
      and private.nexus_tenant_role(old.tenant_id) not in ('owner','admin') then
      raise exception 'Only the campaign owner or tenant administrator may transfer campaign ownership' using errcode = '42501';
    end if;

    if not exists (
      select 1
      from public.nexus_tenants t
      where t.id = old.tenant_id
        and (
          t.owner_id = new.owner_user_id
          or exists (
            select 1 from public.nexus_tenant_members m
            where m.tenant_id = t.id and m.user_id = new.owner_user_id
          )
        )
    ) then
      raise exception 'The new campaign owner must belong to the campaign tenant' using errcode = '23514';
    end if;
  end if;

  return new;
end;
$$;

revoke all on function public.dnd_protect_campaign_identity() from public, anon, authenticated;
drop trigger if exists dnd_campaign_identity_guard on public.dnd_campaigns;
create trigger dnd_campaign_identity_guard
before update of tenant_id, owner_user_id on public.dnd_campaigns
for each row execute function public.dnd_protect_campaign_identity();

-- Assistant DMs manage play/integration operations but cannot promote administrators or change campaign membership.
drop policy if exists campaign_members_insert on public.dnd_campaign_members;
drop policy if exists campaign_members_update on public.dnd_campaign_members;
drop policy if exists campaign_members_delete on public.dnd_campaign_members;

create policy campaign_members_insert on public.dnd_campaign_members
for insert to authenticated
with check (
  public.dnd_campaign_role(campaign_id) in ('admin','dm')
  and (
    role <> 'admin'
    or exists (
      select 1 from public.dnd_campaigns c
      where c.id = campaign_id and public.nexus_tenant_role(c.tenant_id) in ('owner','admin')
    )
  )
);

create policy campaign_members_update on public.dnd_campaign_members
for update to authenticated
using (
  public.dnd_campaign_role(campaign_id) in ('admin','dm')
  and (
    role <> 'admin'
    or exists (
      select 1 from public.dnd_campaigns c
      where c.id = campaign_id and public.nexus_tenant_role(c.tenant_id) in ('owner','admin')
    )
  )
)
with check (
  public.dnd_campaign_role(campaign_id) in ('admin','dm')
  and (
    role <> 'admin'
    or exists (
      select 1 from public.dnd_campaigns c
      where c.id = campaign_id and public.nexus_tenant_role(c.tenant_id) in ('owner','admin')
    )
  )
);

create policy campaign_members_delete on public.dnd_campaign_members
for delete to authenticated
using (
  public.dnd_campaign_role(campaign_id) in ('admin','dm')
  and (
    role <> 'admin'
    or exists (
      select 1 from public.dnd_campaigns c
      where c.id = campaign_id and public.nexus_tenant_role(c.tenant_id) in ('owner','admin')
    )
  )
);

-- Tenant-owned content is visible only inside its tenant.
drop policy if exists content_select on public.dnd_content_entries;
create policy content_select on public.dnd_content_entries
for select to authenticated
using (
  active
  and exists (
    select 1 from public.dnd_sources s
    where s.id = source_id
      and (s.is_full_text_allowed or full_text is null)
      and (s.tenant_id is null or public.nexus_tenant_role(s.tenant_id) is not null)
  )
);

-- Mixed public/private tables are manager-only for direct SELECT. Players use the safe aggregate RPC below.
drop policy if exists campaigns_select on public.dnd_campaigns;
create policy campaigns_select on public.dnd_campaigns
for select to authenticated
using (public.dnd_can_manage_campaign(id));

drop policy if exists characters_select on public.dnd_characters;
create policy characters_select on public.dnd_characters
for select to authenticated
using (owner_user_id = (select auth.uid()) or public.dnd_can_manage_campaign(campaign_id));

drop policy if exists quests_select on public.dnd_quests;
create policy quests_select on public.dnd_quests
for select to authenticated
using (public.dnd_can_manage_campaign(campaign_id));

drop policy if exists npcs_select on public.dnd_npcs;
create policy npcs_select on public.dnd_npcs
for select to authenticated
using (public.dnd_can_manage_campaign(campaign_id));

drop policy if exists locations_select on public.dnd_locations;
create policy locations_select on public.dnd_locations
for select to authenticated
using (public.dnd_can_manage_campaign(campaign_id));

drop policy if exists factions_select on public.dnd_factions;
create policy factions_select on public.dnd_factions
for select to authenticated
using (public.dnd_can_manage_campaign(campaign_id));

drop policy if exists loot_select on public.dnd_loot;
create policy loot_select on public.dnd_loot
for select to authenticated
using (public.dnd_can_manage_campaign(campaign_id));

drop policy if exists sessions_select on public.dnd_sessions;
create policy sessions_select on public.dnd_sessions
for select to authenticated
using (public.dnd_can_manage_campaign(campaign_id));

drop policy if exists calendar_select on public.dnd_calendar_events;
create policy calendar_select on public.dnd_calendar_events
for select to authenticated
using (public.dnd_can_manage_campaign(campaign_id));

drop policy if exists encounters_select on public.dnd_encounters;
create policy encounters_select on public.dnd_encounters
for select to authenticated
using (public.dnd_can_manage_campaign(campaign_id));

drop policy if exists combatants_select on public.dnd_encounter_combatants;
create policy combatants_select on public.dnd_encounter_combatants
for select to authenticated
using (public.dnd_can_manage_campaign(campaign_id));

create or replace function private.dnd_get_campaign_public_state(p_campaign_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, private, pg_temp
as $$
declare result jsonb;
begin
  if not private.dnd_can_view_campaign(p_campaign_id) then
    return null;
  end if;

  select jsonb_build_object(
    'campaign', (
      select jsonb_build_object(
        'id', c.id,
        'name', c.name,
        'description', c.description,
        'status', c.status,
        'ruleset', c.ruleset,
        'currentLocation', c.current_location,
        'activeQuestId', c.active_quest_id,
        'updatedAt', c.updated_at
      )
      from public.dnd_campaigns c where c.id = p_campaign_id
    ),
    'members', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', m.id,
        'displayName', m.display_name,
        'role', m.role
      ) order by m.display_name)
      from public.dnd_campaign_members m
      where m.campaign_id = p_campaign_id and m.active
    ), '[]'::jsonb),
    'party', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', ch.id,
        'name', ch.name,
        'portraitUrl', ch.portrait_url,
        'level', ch.level,
        'className', ch.class_name,
        'hp', ch.hp,
        'maxHp', ch.max_hp,
        'armorClass', ch.armor_class,
        'conditions', ch.conditions,
        'inspiration', ch.inspiration,
        'exhaustion', ch.exhaustion,
        'status', ch.status,
        'activeQuestId', ch.active_quest_id
      ) order by ch.name)
      from public.dnd_characters ch
      where ch.campaign_id = p_campaign_id and ch.status in ('active','backup','deceased')
    ), '[]'::jsonb),
    'quests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', q.id,
        'title', q.title,
        'summary', q.summary,
        'status', q.status
      ) order by q.updated_at desc)
      from public.dnd_quests q
      where q.campaign_id = p_campaign_id and q.visible_to_players and q.status <> 'archived'
    ), '[]'::jsonb),
    'loot', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'name', l.name,
        'quantity', l.quantity,
        'shared', l.shared,
        'assignedCharacterId', l.assigned_character_id
      ) order by l.name)
      from public.dnd_loot l
      where l.campaign_id = p_campaign_id and not l.gm_only
    ), '[]'::jsonb),
    'sessions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id,
        'title', s.title,
        'status', s.status,
        'startsAt', s.starts_at,
        'endsAt', s.ends_at,
        'timezone', s.timezone,
        'agenda', s.agenda,
        'recap', case when s.recap_approved_at is not null then s.recap_draft else '' end,
        'recapApproved', s.recap_approved_at is not null
      ) order by s.starts_at nulls last)
      from public.dnd_sessions s
      where s.campaign_id = p_campaign_id
    ), '[]'::jsonb),
    'calendar', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id,
        'sessionId', e.session_id,
        'title', e.title,
        'startsAt', e.starts_at,
        'endsAt', e.ends_at,
        'timezone', e.timezone
      ) order by e.starts_at)
      from public.dnd_calendar_events e
      where e.campaign_id = p_campaign_id and e.visibility = 'campaign'
    ), '[]'::jsonb),
    'npcs', coalesce((
      select jsonb_agg(jsonb_build_object('id', n.id, 'name', n.name, 'summary', n.public_summary) order by n.name)
      from public.dnd_npcs n where n.campaign_id = p_campaign_id and n.revealed
    ), '[]'::jsonb),
    'locations', coalesce((
      select jsonb_agg(jsonb_build_object('id', l.id, 'name', l.name, 'summary', l.public_summary) order by l.name)
      from public.dnd_locations l where l.campaign_id = p_campaign_id and l.revealed
    ), '[]'::jsonb),
    'factions', coalesce((
      select jsonb_agg(jsonb_build_object('id', f.id, 'name', f.name, 'summary', f.public_summary) order by f.name)
      from public.dnd_factions f where f.campaign_id = p_campaign_id and f.revealed
    ), '[]'::jsonb),
    'encounters', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', en.id,
        'name', en.name,
        'status', en.status,
        'round', en.round,
        'currentTurnIndex', en.current_turn_index,
        'combatants', coalesce((
          select jsonb_agg(jsonb_build_object(
            'id', ec.id,
            'name', ec.name_snapshot,
            'initiative', ec.initiative,
            'hp', ec.hp,
            'maxHp', ec.max_hp,
            'conditions', ec.conditions
          ) order by ec.initiative desc, ec.dexterity desc, ec.id)
          from public.dnd_encounter_combatants ec
          where ec.encounter_id = en.id and ec.active and not ec.hidden
        ), '[]'::jsonb)
      ) order by en.updated_at desc)
      from public.dnd_encounters en
      where en.campaign_id = p_campaign_id and en.status in ('active','paused','completed')
    ), '[]'::jsonb)
  ) into result;

  return result;
end;
$$;

create or replace function public.dnd_get_campaign_public_state(p_campaign_id uuid)
returns jsonb
language sql
stable
security invoker
set search_path = public, private, pg_temp
as $$ select private.dnd_get_campaign_public_state(p_campaign_id) $$;

revoke all on function private.dnd_get_campaign_public_state(uuid) from public, anon;
revoke all on function public.dnd_get_campaign_public_state(uuid) from public, anon;
grant execute on function private.dnd_get_campaign_public_state(uuid) to authenticated, service_role;
grant execute on function public.dnd_get_campaign_public_state(uuid) to authenticated, service_role;

comment on function public.dnd_get_campaign_public_state(uuid) is 'Returns a player-safe campaign projection without GM notes, private metadata, unapproved recaps, hidden world records, hidden combatants, or GM-only loot.';

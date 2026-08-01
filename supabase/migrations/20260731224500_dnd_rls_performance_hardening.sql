-- Reduce repeated auth evaluation, remove overlapping permissive policies, and cover foreign keys.

-- Rebuild direct auth.uid() policies with init-plan-safe scalar selects.
drop policy tenant_select on public.nexus_tenants;
drop policy tenant_insert on public.nexus_tenants;
drop policy tenant_update on public.nexus_tenants;
drop policy tenant_delete on public.nexus_tenants;
create policy tenant_select on public.nexus_tenants for select to authenticated using (owner_id = (select auth.uid()) or exists (select 1 from public.nexus_tenant_members m where m.tenant_id = id and m.user_id = (select auth.uid())));
create policy tenant_insert on public.nexus_tenants for insert to authenticated with check (owner_id = (select auth.uid()));
create policy tenant_update on public.nexus_tenants for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy tenant_delete on public.nexus_tenants for delete to authenticated using (owner_id = (select auth.uid()));

drop policy discord_apps_insert on public.discord_registered_apps;
create policy discord_apps_insert on public.discord_registered_apps for insert to authenticated with check (owner_id = (select auth.uid()) and public.nexus_tenant_role(tenant_id) in ('owner','admin'));
drop policy discord_app_managers_select on public.discord_app_managers;
create policy discord_app_managers_select on public.discord_app_managers for select to authenticated using (public.dnd_user_can_manage_app(app_id) or user_id = (select auth.uid()));

drop policy campaigns_insert on public.dnd_campaigns;
create policy campaigns_insert on public.dnd_campaigns for insert to authenticated with check (owner_user_id = (select auth.uid()) and public.nexus_tenant_role(tenant_id) in ('owner','admin','member'));

drop policy homebrew_select on public.dnd_homebrew;
drop policy homebrew_insert on public.dnd_homebrew;
drop policy homebrew_update on public.dnd_homebrew;
create policy homebrew_select on public.dnd_homebrew for select to authenticated using (public.dnd_can_view_campaign(campaign_id) and (status = 'approved' or author_user_id = (select auth.uid()) or public.dnd_can_manage_campaign(campaign_id)));
create policy homebrew_insert on public.dnd_homebrew for insert to authenticated with check (author_user_id = (select auth.uid()) and public.dnd_can_view_campaign(campaign_id));
create policy homebrew_update on public.dnd_homebrew for update to authenticated using (author_user_id = (select auth.uid()) or public.dnd_can_manage_campaign(campaign_id)) with check (author_user_id = (select auth.uid()) or public.dnd_can_manage_campaign(campaign_id));

drop policy characters_insert on public.dnd_characters;
drop policy characters_update on public.dnd_characters;
drop policy characters_delete on public.dnd_characters;
create policy characters_insert on public.dnd_characters for insert to authenticated with check ((owner_user_id = (select auth.uid()) or public.dnd_can_manage_campaign(campaign_id)) and public.dnd_can_view_campaign(campaign_id));
create policy characters_update on public.dnd_characters for update to authenticated using (owner_user_id = (select auth.uid()) or public.dnd_can_manage_campaign(campaign_id)) with check (owner_user_id = (select auth.uid()) or public.dnd_can_manage_campaign(campaign_id));
create policy characters_delete on public.dnd_characters for delete to authenticated using (owner_user_id = (select auth.uid()) or public.dnd_can_manage_campaign(campaign_id));

drop policy attendance_insert on public.dnd_session_attendance;
drop policy attendance_update on public.dnd_session_attendance;
drop policy attendance_delete on public.dnd_session_attendance;
create policy attendance_insert on public.dnd_session_attendance for insert to authenticated with check ((user_id = (select auth.uid()) or public.dnd_can_manage_campaign(campaign_id)) and public.dnd_can_view_campaign(campaign_id));
create policy attendance_update on public.dnd_session_attendance for update to authenticated using (user_id = (select auth.uid()) or public.dnd_can_manage_campaign(campaign_id)) with check (user_id = (select auth.uid()) or public.dnd_can_manage_campaign(campaign_id));
create policy attendance_delete on public.dnd_session_attendance for delete to authenticated using (user_id = (select auth.uid()) or public.dnd_can_manage_campaign(campaign_id));

drop policy combatants_insert on public.dnd_encounter_combatants;
create policy combatants_insert on public.dnd_encounter_combatants for insert to authenticated with check (public.dnd_can_manage_campaign(campaign_id) or exists (select 1 from public.dnd_characters c where c.id = character_id and c.campaign_id = campaign_id and c.owner_user_id = (select auth.uid())));

drop policy rolls_select on public.dnd_dice_rolls;
drop policy rolls_insert on public.dnd_dice_rolls;
create policy rolls_select on public.dnd_dice_rolls for select to authenticated using (public.dnd_can_manage_campaign(campaign_id) or (public.dnd_can_view_campaign(campaign_id) and (privacy = 'public' or user_id = (select auth.uid()))));
create policy rolls_insert on public.dnd_dice_rolls for insert to authenticated with check (public.dnd_can_view_campaign(campaign_id) and user_id = (select auth.uid()));

drop policy audit_insert on public.dnd_audit_log;
create policy audit_insert on public.dnd_audit_log for insert to authenticated with check (actor_user_id = (select auth.uid()) and public.nexus_tenant_role(tenant_id) is not null);

-- Replace FOR ALL policies so SELECT has one permissive policy per table.
drop policy tenant_members_manage on public.nexus_tenant_members;
create policy tenant_members_insert on public.nexus_tenant_members for insert to authenticated with check (public.nexus_tenant_role(tenant_id) in ('owner','admin'));
create policy tenant_members_update on public.nexus_tenant_members for update to authenticated using (public.nexus_tenant_role(tenant_id) in ('owner','admin')) with check (public.nexus_tenant_role(tenant_id) in ('owner','admin'));
create policy tenant_members_delete on public.nexus_tenant_members for delete to authenticated using (public.nexus_tenant_role(tenant_id) in ('owner','admin'));

drop policy discord_app_managers_manage on public.discord_app_managers;
create policy discord_app_managers_insert on public.discord_app_managers for insert to authenticated with check (public.dnd_user_can_manage_app(app_id));
create policy discord_app_managers_update on public.discord_app_managers for update to authenticated using (public.dnd_user_can_manage_app(app_id)) with check (public.dnd_user_can_manage_app(app_id));
create policy discord_app_managers_delete on public.discord_app_managers for delete to authenticated using (public.dnd_user_can_manage_app(app_id));

drop policy discord_role_mappings_manage on public.discord_role_mappings;
create policy discord_role_mappings_insert on public.discord_role_mappings for insert to authenticated with check (public.dnd_user_can_manage_app(app_id) and nexus_role in ('viewer','operator'));
create policy discord_role_mappings_update on public.discord_role_mappings for update to authenticated using (public.dnd_user_can_manage_app(app_id)) with check (public.dnd_user_can_manage_app(app_id) and nexus_role in ('viewer','operator'));
create policy discord_role_mappings_delete on public.discord_role_mappings for delete to authenticated using (public.dnd_user_can_manage_app(app_id));

drop policy campaign_members_manage on public.dnd_campaign_members;
create policy campaign_members_insert on public.dnd_campaign_members for insert to authenticated with check (public.dnd_can_manage_campaign(campaign_id));
create policy campaign_members_update on public.dnd_campaign_members for update to authenticated using (public.dnd_can_manage_campaign(campaign_id)) with check (public.dnd_can_manage_campaign(campaign_id));
create policy campaign_members_delete on public.dnd_campaign_members for delete to authenticated using (public.dnd_can_manage_campaign(campaign_id));

drop policy sources_manage on public.dnd_sources;
create policy sources_insert on public.dnd_sources for insert to authenticated with check (tenant_id is not null and public.nexus_tenant_role(tenant_id) in ('owner','admin'));
create policy sources_update on public.dnd_sources for update to authenticated using (tenant_id is not null and public.nexus_tenant_role(tenant_id) in ('owner','admin')) with check (tenant_id is not null and public.nexus_tenant_role(tenant_id) in ('owner','admin'));
create policy sources_delete on public.dnd_sources for delete to authenticated using (tenant_id is not null and public.nexus_tenant_role(tenant_id) in ('owner','admin'));

drop policy campaign_sources_manage on public.dnd_campaign_sources;
create policy campaign_sources_insert on public.dnd_campaign_sources for insert to authenticated with check (public.dnd_can_manage_campaign(campaign_id));
create policy campaign_sources_update on public.dnd_campaign_sources for update to authenticated using (public.dnd_can_manage_campaign(campaign_id)) with check (public.dnd_can_manage_campaign(campaign_id));
create policy campaign_sources_delete on public.dnd_campaign_sources for delete to authenticated using (public.dnd_can_manage_campaign(campaign_id));

drop policy content_manage on public.dnd_content_entries;
create policy content_insert on public.dnd_content_entries for insert to authenticated with check (exists (select 1 from public.dnd_sources s where s.id = source_id and s.tenant_id is not null and public.nexus_tenant_role(s.tenant_id) in ('owner','admin') and (s.is_full_text_allowed or full_text is null)));
create policy content_update on public.dnd_content_entries for update to authenticated using (exists (select 1 from public.dnd_sources s where s.id = source_id and s.tenant_id is not null and public.nexus_tenant_role(s.tenant_id) in ('owner','admin'))) with check (exists (select 1 from public.dnd_sources s where s.id = source_id and s.tenant_id is not null and public.nexus_tenant_role(s.tenant_id) in ('owner','admin') and (s.is_full_text_allowed or full_text is null)));
create policy content_delete on public.dnd_content_entries for delete to authenticated using (exists (select 1 from public.dnd_sources s where s.id = source_id and s.tenant_id is not null and public.nexus_tenant_role(s.tenant_id) in ('owner','admin')));

-- Uniform campaign-managed tables.
do $$
declare item record;
begin
  for item in select * from (values
    ('dnd_quests','quests'), ('dnd_npcs','npcs'), ('dnd_locations','locations'), ('dnd_factions','factions'),
    ('dnd_loot','loot'), ('dnd_sessions','sessions'), ('dnd_calendar_events','calendar'), ('dnd_encounters','encounters'),
    ('dnd_discord_bindings','bindings'), ('dnd_bot_campaign_grants','grants'), ('dnd_shared_channel_contexts','contexts')
  ) as v(table_name, policy_prefix)
  loop
    execute format('drop policy %I_manage on public.%I', item.policy_prefix, item.table_name);
    if item.table_name in ('dnd_discord_bindings','dnd_bot_campaign_grants','dnd_shared_channel_contexts') then
      execute format('create policy %I_insert on public.%I for insert to authenticated with check (public.dnd_can_manage_campaign(campaign_id) and public.dnd_user_can_manage_app(registered_app_id))', item.policy_prefix, item.table_name);
      execute format('create policy %I_update on public.%I for update to authenticated using (public.dnd_can_manage_campaign(campaign_id) and public.dnd_user_can_manage_app(registered_app_id)) with check (public.dnd_can_manage_campaign(campaign_id) and public.dnd_user_can_manage_app(registered_app_id))', item.policy_prefix, item.table_name);
      execute format('create policy %I_delete on public.%I for delete to authenticated using (public.dnd_can_manage_campaign(campaign_id) and public.dnd_user_can_manage_app(registered_app_id))', item.policy_prefix, item.table_name);
    else
      execute format('create policy %I_insert on public.%I for insert to authenticated with check (public.dnd_can_manage_campaign(campaign_id))', item.policy_prefix, item.table_name);
      execute format('create policy %I_update on public.%I for update to authenticated using (public.dnd_can_manage_campaign(campaign_id)) with check (public.dnd_can_manage_campaign(campaign_id))', item.policy_prefix, item.table_name);
      execute format('create policy %I_delete on public.%I for delete to authenticated using (public.dnd_can_manage_campaign(campaign_id))', item.policy_prefix, item.table_name);
    end if;
  end loop;
end $$;

drop policy panels_manage on public.dnd_campaign_panels;
create policy panels_insert on public.dnd_campaign_panels for insert to authenticated with check (exists (select 1 from public.dnd_discord_bindings b where b.id = binding_id and public.dnd_can_manage_campaign(b.campaign_id) and public.dnd_user_can_manage_app(b.registered_app_id)));
create policy panels_update on public.dnd_campaign_panels for update to authenticated using (exists (select 1 from public.dnd_discord_bindings b where b.id = binding_id and public.dnd_can_manage_campaign(b.campaign_id) and public.dnd_user_can_manage_app(b.registered_app_id))) with check (exists (select 1 from public.dnd_discord_bindings b where b.id = binding_id and public.dnd_can_manage_campaign(b.campaign_id) and public.dnd_user_can_manage_app(b.registered_app_id)));
create policy panels_delete on public.dnd_campaign_panels for delete to authenticated using (exists (select 1 from public.dnd_discord_bindings b where b.id = binding_id and public.dnd_can_manage_campaign(b.campaign_id) and public.dnd_user_can_manage_app(b.registered_app_id)));

-- Create one covering index for every public foreign key. Redundant names are avoided by constraint-derived names.
do $$
declare fk record;
declare idx_name text;
begin
  for fk in
    select c.conname, c.conrelid::regclass as table_name,
      string_agg(quote_ident(a.attname), ', ' order by u.ordinality) as columns
    from pg_constraint c
    cross join lateral unnest(c.conkey) with ordinality u(attnum, ordinality)
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = u.attnum
    join pg_class r on r.oid = c.conrelid
    join pg_namespace n on n.oid = r.relnamespace
    where c.contype = 'f' and n.nspname = 'public'
    group by c.conname, c.conrelid
  loop
    idx_name := left(replace(fk.table_name::text, 'public.', '') || '_' || fk.conname || '_idx', 63);
    execute format('create index if not exists %I on %s (%s)', idx_name, fk.table_name, fk.columns);
  end loop;
end $$;

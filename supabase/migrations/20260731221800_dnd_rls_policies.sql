-- RLS is mandatory on every application table.
alter table public.nexus_tenants enable row level security;
alter table public.nexus_tenant_members enable row level security;
alter table public.discord_registered_apps enable row level security;
alter table public.discord_app_managers enable row level security;
alter table public.discord_role_mappings enable row level security;
alter table public.dnd_campaigns enable row level security;
alter table public.dnd_campaign_members enable row level security;
alter table public.dnd_sources enable row level security;
alter table public.dnd_campaign_sources enable row level security;
alter table public.dnd_content_entries enable row level security;
alter table public.dnd_homebrew enable row level security;
alter table public.dnd_characters enable row level security;
alter table public.dnd_quests enable row level security;
alter table public.dnd_npcs enable row level security;
alter table public.dnd_locations enable row level security;
alter table public.dnd_factions enable row level security;
alter table public.dnd_loot enable row level security;
alter table public.dnd_sessions enable row level security;
alter table public.dnd_session_attendance enable row level security;
alter table public.dnd_calendar_events enable row level security;
alter table public.dnd_encounters enable row level security;
alter table public.dnd_encounter_combatants enable row level security;
alter table public.dnd_dice_rolls enable row level security;
alter table public.dnd_discord_bindings enable row level security;
alter table public.dnd_bot_campaign_grants enable row level security;
alter table public.dnd_shared_channel_contexts enable row level security;
alter table public.dnd_campaign_panels enable row level security;
alter table public.dnd_audit_log enable row level security;

create policy tenant_select on public.nexus_tenants for select to authenticated using (owner_id = auth.uid() or exists (select 1 from public.nexus_tenant_members m where m.tenant_id = id and m.user_id = auth.uid()));
create policy tenant_insert on public.nexus_tenants for insert to authenticated with check (owner_id = auth.uid());
create policy tenant_update on public.nexus_tenants for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy tenant_delete on public.nexus_tenants for delete to authenticated using (owner_id = auth.uid());

create policy tenant_members_select on public.nexus_tenant_members for select to authenticated using (public.nexus_tenant_role(tenant_id) is not null);
create policy tenant_members_manage on public.nexus_tenant_members for all to authenticated using (public.nexus_tenant_role(tenant_id) in ('owner','admin')) with check (public.nexus_tenant_role(tenant_id) in ('owner','admin'));

create policy discord_apps_select on public.discord_registered_apps for select to authenticated using (public.nexus_tenant_role(tenant_id) is not null);
create policy discord_apps_insert on public.discord_registered_apps for insert to authenticated with check (owner_id = auth.uid() and public.nexus_tenant_role(tenant_id) in ('owner','admin'));
create policy discord_apps_update on public.discord_registered_apps for update to authenticated using (public.dnd_user_can_manage_app(id)) with check (public.dnd_user_can_manage_app(id));
create policy discord_apps_delete on public.discord_registered_apps for delete to authenticated using (public.dnd_user_can_manage_app(id));
create policy discord_app_managers_select on public.discord_app_managers for select to authenticated using (public.dnd_user_can_manage_app(app_id) or user_id = auth.uid());
create policy discord_app_managers_manage on public.discord_app_managers for all to authenticated using (public.dnd_user_can_manage_app(app_id)) with check (public.dnd_user_can_manage_app(app_id));
create policy discord_role_mappings_select on public.discord_role_mappings for select to authenticated using (public.dnd_user_can_manage_app(app_id));
create policy discord_role_mappings_manage on public.discord_role_mappings for all to authenticated using (public.dnd_user_can_manage_app(app_id)) with check (public.dnd_user_can_manage_app(app_id) and nexus_role in ('viewer','operator'));

create policy campaigns_select on public.dnd_campaigns for select to authenticated using (public.dnd_can_view_campaign(id));
create policy campaigns_insert on public.dnd_campaigns for insert to authenticated with check (owner_user_id = auth.uid() and public.nexus_tenant_role(tenant_id) in ('owner','admin','member'));
create policy campaigns_update on public.dnd_campaigns for update to authenticated using (public.dnd_can_manage_campaign(id)) with check (public.dnd_can_manage_campaign(id));
create policy campaigns_delete on public.dnd_campaigns for delete to authenticated using (public.dnd_campaign_role(id) in ('admin','dm'));

create policy campaign_members_select on public.dnd_campaign_members for select to authenticated using (public.dnd_can_view_campaign(campaign_id));
create policy campaign_members_manage on public.dnd_campaign_members for all to authenticated using (public.dnd_can_manage_campaign(campaign_id)) with check (public.dnd_can_manage_campaign(campaign_id));

create policy sources_select on public.dnd_sources for select to authenticated using (active and (tenant_id is null or public.nexus_tenant_role(tenant_id) is not null));
create policy sources_manage on public.dnd_sources for all to authenticated using (tenant_id is not null and public.nexus_tenant_role(tenant_id) in ('owner','admin')) with check (tenant_id is not null and public.nexus_tenant_role(tenant_id) in ('owner','admin'));
create policy campaign_sources_select on public.dnd_campaign_sources for select to authenticated using (public.dnd_can_view_campaign(campaign_id));
create policy campaign_sources_manage on public.dnd_campaign_sources for all to authenticated using (public.dnd_can_manage_campaign(campaign_id)) with check (public.dnd_can_manage_campaign(campaign_id));
create policy content_select on public.dnd_content_entries for select to authenticated using (active and exists (select 1 from public.dnd_sources s where s.id = source_id and (s.is_full_text_allowed or full_text is null)));
create policy content_manage on public.dnd_content_entries for all to authenticated using (exists (select 1 from public.dnd_sources s where s.id = source_id and s.tenant_id is not null and public.nexus_tenant_role(s.tenant_id) in ('owner','admin'))) with check (exists (select 1 from public.dnd_sources s where s.id = source_id and s.tenant_id is not null and public.nexus_tenant_role(s.tenant_id) in ('owner','admin') and (s.is_full_text_allowed or full_text is null)));

create policy homebrew_select on public.dnd_homebrew for select to authenticated using (public.dnd_can_view_campaign(campaign_id) and (status = 'approved' or author_user_id = auth.uid() or public.dnd_can_manage_campaign(campaign_id)));
create policy homebrew_insert on public.dnd_homebrew for insert to authenticated with check (author_user_id = auth.uid() and public.dnd_can_view_campaign(campaign_id));
create policy homebrew_update on public.dnd_homebrew for update to authenticated using (author_user_id = auth.uid() or public.dnd_can_manage_campaign(campaign_id)) with check (author_user_id = auth.uid() or public.dnd_can_manage_campaign(campaign_id));

create policy characters_select on public.dnd_characters for select to authenticated using (public.dnd_can_view_campaign(campaign_id));
create policy characters_insert on public.dnd_characters for insert to authenticated with check ((owner_user_id = auth.uid() or public.dnd_can_manage_campaign(campaign_id)) and public.dnd_can_view_campaign(campaign_id));
create policy characters_update on public.dnd_characters for update to authenticated using (owner_user_id = auth.uid() or public.dnd_can_manage_campaign(campaign_id)) with check (owner_user_id = auth.uid() or public.dnd_can_manage_campaign(campaign_id));
create policy characters_delete on public.dnd_characters for delete to authenticated using (owner_user_id = auth.uid() or public.dnd_can_manage_campaign(campaign_id));

create policy quests_select on public.dnd_quests for select to authenticated using (public.dnd_can_manage_campaign(campaign_id) or (public.dnd_can_view_campaign(campaign_id) and visible_to_players));
create policy quests_manage on public.dnd_quests for all to authenticated using (public.dnd_can_manage_campaign(campaign_id)) with check (public.dnd_can_manage_campaign(campaign_id));
create policy npcs_select on public.dnd_npcs for select to authenticated using (public.dnd_can_manage_campaign(campaign_id) or (public.dnd_can_view_campaign(campaign_id) and revealed));
create policy npcs_manage on public.dnd_npcs for all to authenticated using (public.dnd_can_manage_campaign(campaign_id)) with check (public.dnd_can_manage_campaign(campaign_id));
create policy locations_select on public.dnd_locations for select to authenticated using (public.dnd_can_manage_campaign(campaign_id) or (public.dnd_can_view_campaign(campaign_id) and revealed));
create policy locations_manage on public.dnd_locations for all to authenticated using (public.dnd_can_manage_campaign(campaign_id)) with check (public.dnd_can_manage_campaign(campaign_id));
create policy factions_select on public.dnd_factions for select to authenticated using (public.dnd_can_manage_campaign(campaign_id) or (public.dnd_can_view_campaign(campaign_id) and revealed));
create policy factions_manage on public.dnd_factions for all to authenticated using (public.dnd_can_manage_campaign(campaign_id)) with check (public.dnd_can_manage_campaign(campaign_id));
create policy loot_select on public.dnd_loot for select to authenticated using (public.dnd_can_manage_campaign(campaign_id) or (public.dnd_can_view_campaign(campaign_id) and not gm_only));
create policy loot_manage on public.dnd_loot for all to authenticated using (public.dnd_can_manage_campaign(campaign_id)) with check (public.dnd_can_manage_campaign(campaign_id));

create policy sessions_select on public.dnd_sessions for select to authenticated using (public.dnd_can_view_campaign(campaign_id));
create policy sessions_manage on public.dnd_sessions for all to authenticated using (public.dnd_can_manage_campaign(campaign_id)) with check (public.dnd_can_manage_campaign(campaign_id));
create policy attendance_select on public.dnd_session_attendance for select to authenticated using (public.dnd_can_view_campaign(campaign_id));
create policy attendance_insert on public.dnd_session_attendance for insert to authenticated with check ((user_id = auth.uid() or public.dnd_can_manage_campaign(campaign_id)) and public.dnd_can_view_campaign(campaign_id));
create policy attendance_update on public.dnd_session_attendance for update to authenticated using (user_id = auth.uid() or public.dnd_can_manage_campaign(campaign_id)) with check (user_id = auth.uid() or public.dnd_can_manage_campaign(campaign_id));
create policy attendance_delete on public.dnd_session_attendance for delete to authenticated using (user_id = auth.uid() or public.dnd_can_manage_campaign(campaign_id));
create policy calendar_select on public.dnd_calendar_events for select to authenticated using (public.dnd_can_manage_campaign(campaign_id) or (public.dnd_can_view_campaign(campaign_id) and visibility = 'campaign'));
create policy calendar_manage on public.dnd_calendar_events for all to authenticated using (public.dnd_can_manage_campaign(campaign_id)) with check (public.dnd_can_manage_campaign(campaign_id));

create policy encounters_select on public.dnd_encounters for select to authenticated using (public.dnd_can_view_campaign(campaign_id));
create policy encounters_manage on public.dnd_encounters for all to authenticated using (public.dnd_can_manage_campaign(campaign_id)) with check (public.dnd_can_manage_campaign(campaign_id));
create policy combatants_select on public.dnd_encounter_combatants for select to authenticated using (public.dnd_can_manage_campaign(campaign_id) or (public.dnd_can_view_campaign(campaign_id) and not hidden));
create policy combatants_insert on public.dnd_encounter_combatants for insert to authenticated with check (public.dnd_can_manage_campaign(campaign_id) or exists (select 1 from public.dnd_characters c where c.id = character_id and c.campaign_id = campaign_id and c.owner_user_id = auth.uid()));
create policy combatants_manage on public.dnd_encounter_combatants for update to authenticated using (public.dnd_can_manage_campaign(campaign_id)) with check (public.dnd_can_manage_campaign(campaign_id));
create policy combatants_delete on public.dnd_encounter_combatants for delete to authenticated using (public.dnd_can_manage_campaign(campaign_id));

create policy rolls_select on public.dnd_dice_rolls for select to authenticated using (public.dnd_can_manage_campaign(campaign_id) or (public.dnd_can_view_campaign(campaign_id) and (privacy = 'public' or user_id = auth.uid())));
create policy rolls_insert on public.dnd_dice_rolls for insert to authenticated with check (public.dnd_can_view_campaign(campaign_id) and user_id = auth.uid());

create policy bindings_select on public.dnd_discord_bindings for select to authenticated using (public.dnd_can_manage_campaign(campaign_id));
create policy bindings_manage on public.dnd_discord_bindings for all to authenticated using (public.dnd_can_manage_campaign(campaign_id) and public.dnd_user_can_manage_app(registered_app_id)) with check (public.dnd_can_manage_campaign(campaign_id) and public.dnd_user_can_manage_app(registered_app_id));
create policy grants_select on public.dnd_bot_campaign_grants for select to authenticated using (public.dnd_can_manage_campaign(campaign_id));
create policy grants_manage on public.dnd_bot_campaign_grants for all to authenticated using (public.dnd_can_manage_campaign(campaign_id) and public.dnd_user_can_manage_app(registered_app_id)) with check (public.dnd_can_manage_campaign(campaign_id) and public.dnd_user_can_manage_app(registered_app_id));
create policy contexts_select on public.dnd_shared_channel_contexts for select to authenticated using (public.dnd_can_manage_campaign(campaign_id));
create policy contexts_manage on public.dnd_shared_channel_contexts for all to authenticated using (public.dnd_can_manage_campaign(campaign_id) and public.dnd_user_can_manage_app(registered_app_id)) with check (public.dnd_can_manage_campaign(campaign_id) and public.dnd_user_can_manage_app(registered_app_id));
create policy panels_select on public.dnd_campaign_panels for select to authenticated using (exists (select 1 from public.dnd_discord_bindings b where b.id = binding_id and public.dnd_can_manage_campaign(b.campaign_id)));
create policy panels_manage on public.dnd_campaign_panels for all to authenticated using (exists (select 1 from public.dnd_discord_bindings b where b.id = binding_id and public.dnd_can_manage_campaign(b.campaign_id) and public.dnd_user_can_manage_app(b.registered_app_id))) with check (exists (select 1 from public.dnd_discord_bindings b where b.id = binding_id and public.dnd_can_manage_campaign(b.campaign_id) and public.dnd_user_can_manage_app(b.registered_app_id)));
create policy audit_select on public.dnd_audit_log for select to authenticated using (public.nexus_tenant_role(tenant_id) in ('owner','admin') or (campaign_id is not null and public.dnd_can_manage_campaign(campaign_id)));
create policy audit_insert on public.dnd_audit_log for insert to authenticated with check (actor_user_id = auth.uid() and (public.nexus_tenant_role(tenant_id) is not null));

-- Explicit grants. Tokens/credentials are intentionally absent from all API-facing tables.
grant usage on schema public to authenticated, service_role;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant all on all tables in schema public to service_role;

comment on table public.dnd_discord_bindings is 'Binds a campaign to one existing Discord channel, thread, or forum post. Category creation is not represented or permitted.';
comment on table public.dnd_campaign_panels is 'One persistent editable campaign-panel message per binding; content_hash excludes volatile timestamps.';
comment on table public.dnd_bot_campaign_grants is 'Least-privilege D&D scopes for a registered Discord app, campaign, and guild.';
comment on table public.dnd_dice_rolls is 'Private roll rows are protected by RLS. Blind rolls must only be inserted after safe DM delivery is available.';

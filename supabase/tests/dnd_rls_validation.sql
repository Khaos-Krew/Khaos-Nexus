-- Transactional validation for D&D tenant isolation, private-field redaction,
-- DM-destination redaction, assistant-DM limits, and ownership protection.
-- Run against a migrated test/staging project. The final ROLLBACK removes all fixtures.

begin;

insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at, is_sso_user, is_anonymous)
values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','00000000-0000-0000-0000-000000000000','authenticated','authenticated','dnd-owner-test@invalid.local','',now(),'{}','{}',now(),now(),false,false),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','00000000-0000-0000-0000-000000000000','authenticated','authenticated','dnd-player-test@invalid.local','',now(),'{}','{}',now(),now(),false,false),
('cccccccc-cccc-4ccc-8ccc-cccccccccccc','00000000-0000-0000-0000-000000000000','authenticated','authenticated','dnd-assistant-test@invalid.local','',now(),'{}','{}',now(),now(),false,false),
('dddddddd-dddd-4ddd-8ddd-dddddddddddd','00000000-0000-0000-0000-000000000000','authenticated','authenticated','dnd-outsider-test@invalid.local','',now(),'{}','{}',now(),now(),false,false);

insert into public.nexus_tenants (id, name, owner_id)
values ('11111111-1111-4111-8111-111111111111','RLS Test Tenant','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

insert into public.nexus_tenant_members (tenant_id, user_id, role)
values
('11111111-1111-4111-8111-111111111111','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','member'),
('11111111-1111-4111-8111-111111111111','cccccccc-cccc-4ccc-8ccc-cccccccccccc','member');

insert into public.discord_registered_apps (id, tenant_id, owner_id, application_id, bot_user_id, display_name, modules)
values ('77777777-7777-4777-8777-777777777777','11111111-1111-4111-8111-111111111111','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','100000000000000001','100000000000000002','RLS Test Bot',array['dnd-workspace']);

insert into public.dnd_campaigns (id, tenant_id, name, description, owner_user_id)
values ('22222222-2222-4222-8222-222222222222','11111111-1111-4111-8111-111111111111','RLS Test Campaign','Safe description','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');

insert into public.dnd_campaign_members (campaign_id, user_id, display_name, role)
values
('22222222-2222-4222-8222-222222222222','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','Player','player'),
('22222222-2222-4222-8222-222222222222','cccccccc-cccc-4ccc-8ccc-cccccccccccc','Assistant','assistant_dm');

insert into public.dnd_sources (id, tenant_id, name, license_type, is_full_text_allowed)
values ('33333333-3333-4333-8333-333333333333','11111111-1111-4111-8111-111111111111','Tenant Source','user_authored',true);

insert into public.dnd_content_entries (id, source_id, content_type, name, summary, full_text)
values ('44444444-4444-4444-8444-444444444444','33333333-3333-4333-8333-333333333333','rule','Tenant Rule','Safe summary','Tenant-only full text');

insert into public.dnd_quests (id, campaign_id, title, summary, gm_notes, status, visible_to_players)
values ('55555555-5555-4555-8555-555555555555','22222222-2222-4222-8222-222222222222','Visible Quest','Public quest summary','SECRET_GM_QUEST_NOTE','active',true);

insert into public.dnd_sessions (id, campaign_id, title, status, agenda, dm_notes, recap_draft)
values ('66666666-6666-4666-8666-666666666666','22222222-2222-4222-8222-222222222222','Visible Session','planned','Public agenda','SECRET_DM_SESSION_NOTE','UNAPPROVED_RECAP');

insert into public.dnd_discord_bindings (id, campaign_id, registered_app_id, guild_id, resource_type, resource_id, display_name, purpose, creator_id, verified_at)
values
('88888888-8888-4888-8888-888888888888','22222222-2222-4222-8222-222222222222','77777777-7777-4777-8777-777777777777','100000000000000003','channel','100000000000000004','Public Channel','main','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now()),
('99999999-9999-4999-8999-999999999999','22222222-2222-4222-8222-222222222222','77777777-7777-4777-8777-777777777777','100000000000000003','channel','100000000000000005','Secret DM Channel','dm_private','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',now());

create temporary table rls_test_results (test_name text primary key, passed boolean not null, detail text not null);
grant all on table pg_temp.rls_test_results to authenticated;

set local role authenticated;
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true), set_config('request.jwt.claim.role','authenticated',true);

insert into pg_temp.rls_test_results
select 'player_public_state_redacts_gm_fields',
       state is not null
       and state::text not like '%SECRET_GM_QUEST_NOTE%'
       and state::text not like '%SECRET_DM_SESSION_NOTE%'
       and state::text not like '%UNAPPROVED_RECAP%',
       coalesce(state::text,'NULL')
from (select public.dnd_get_campaign_public_state('22222222-2222-4222-8222-222222222222') as state) s;

insert into pg_temp.rls_test_results
select 'player_direct_quest_select_blocked', count(*) = 0, 'rows=' || count(*)
from public.dnd_quests where campaign_id='22222222-2222-4222-8222-222222222222';

insert into pg_temp.rls_test_results
select 'player_public_bindings_exclude_dm_private', count(*) = 1 and bool_and(purpose <> 'dm_private'), 'rows=' || count(*) || ', purposes=' || coalesce(string_agg(purpose,','),'')
from public.dnd_get_public_bindings('22222222-2222-4222-8222-222222222222');

insert into pg_temp.rls_test_results
select 'player_tenant_content_visible', count(*) = 1, 'rows=' || count(*)
from public.dnd_content_entries where id='44444444-4444-4444-8444-444444444444';

select set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-cccccccccccc',true);

do $$
begin
  begin
    insert into public.dnd_campaign_members (campaign_id, user_id, display_name, role)
    values ('22222222-2222-4222-8222-222222222222','dddddddd-dddd-4ddd-8ddd-dddddddddddd','Outsider','player');
    insert into pg_temp.rls_test_results values ('assistant_member_management_blocked',false,'insert unexpectedly succeeded');
  exception when insufficient_privilege then
    insert into pg_temp.rls_test_results values ('assistant_member_management_blocked',true,'RLS denied assistant membership change');
  end;

  begin
    update public.dnd_campaigns
    set owner_user_id='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
    where id='22222222-2222-4222-8222-222222222222';
    insert into pg_temp.rls_test_results values ('assistant_ownership_transfer_blocked',false,'update unexpectedly succeeded');
  exception when insufficient_privilege then
    insert into pg_temp.rls_test_results values ('assistant_ownership_transfer_blocked',true,'ownership trigger denied assistant transfer');
  end;
end $$;

select set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',true);

insert into pg_temp.rls_test_results
select 'outsider_public_state_denied', public.dnd_get_campaign_public_state('22222222-2222-4222-8222-222222222222') is null, 'state must be NULL';

insert into pg_temp.rls_test_results
select 'outsider_tenant_content_denied', count(*) = 0, 'rows=' || count(*)
from public.dnd_content_entries where id='44444444-4444-4444-8444-444444444444';

insert into pg_temp.rls_test_results
select 'outsider_public_bindings_denied', count(*) = 0, 'rows=' || count(*)
from public.dnd_get_public_bindings('22222222-2222-4222-8222-222222222222');

select test_name, passed, detail from pg_temp.rls_test_results order by test_name;
rollback;

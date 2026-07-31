# D&D Discord Campaign Integration

## Architecture

This feature extends the existing local-first Khaos Nexus Electron application. It preserves the supervised Discord runtime, Discord Studio, encrypted credential storage, module registry, audit logging, game-server commands, and existing Nexus Bot configuration.

`dnd-workspace` is a first-class registered-bot module. Nexus Bot is represented as the legacy registered app and uses the same command definitions, campaign resolver, grants, scopes, privacy rules, initiative rules, and session lifecycle as additional registered Discord apps. No production Discord application ID is hardcoded.

The desktop gateway remains the authority for Discord interactions. Supabase provides the multi-tenant shared-data and RLS foundation. No bot-token column exists in the API-facing schema; desktop bot tokens remain protected with Electron `safeStorage` and are never returned to the renderer.

## Schema and migrations

Fresh environments apply these migrations in order:

1. `20260731221500_dnd_foundation.sql`
2. `20260731221600_dnd_play_and_discord_entities.sql`
3. `20260731221700_dnd_authorization_helpers.sql`
4. `20260731221800_dnd_rls_policies.sql`
5. `20260731223000_dnd_security_definer_hardening.sql`
6. `20260731224500_dnd_rls_performance_hardening.sql`
7. `20260731225000_dnd_index_deduplication.sql`

The series creates tenant, registered-app, campaign, member, source, content, homebrew, character, quest, world, loot, session, attendance, calendar, encounter, initiative, dice-roll, Discord binding, bot-grant, channel-context, persistent-panel, and audit structures.

Core Discord records:

- `discord_registered_apps`: non-secret application metadata.
- `discord_app_managers`: users explicitly authorized to manage an app.
- `dnd_discord_bindings`: campaign-to-channel/thread/forum-post bindings.
- `dnd_bot_campaign_grants`: campaign/guild scopes for a registered app.
- `dnd_shared_channel_contexts`: explicit active campaign for a shared channel.
- `dnd_campaign_panels`: one persistent message per binding.
- `dnd_session_attendance`: attending, maybe, unavailable, or late.

Constraints prevent duplicate active campaign-resource bindings and more than one active primary `main` binding for the same campaign, app, and guild.

## Setup flow

The default setup mode is **Do not create anything**. Saving that option performs no Discord REST request and creates no Discord resource.

Supported modes:

1. Do not create anything.
2. Assign an existing text channel.
3. Assign an existing thread.
4. Assign an existing forum post.
5. Create one thread in an explicitly selected text channel.
6. Create one forum post in an explicitly selected forum.

Creation requires deliberate confirmation and each operation creates at most one resource. Category creation, multiple channel creation, voice-channel creation, and full campaign server scaffolding are unavailable.

When synced resources are unavailable, users can enable Discord Developer Mode and copy the server, channel, thread, or forum-post ID manually.

## Registered-bot authorization

A registered app must:

- Be enabled.
- Have `dnd-workspace` enabled.
- Have a protected token on the desktop installation running it.
- Have a campaign grant for the campaign and guild.
- Have every scope required by the command.
- Be owned by, or explicitly manageable by, the user configuring it.

Supported scopes:

- `campaign:read`
- `characters:read`
- `characters:update`
- `rolls:create`
- `encounters:manage`
- `sessions:manage`
- `quests:read`
- `panels:manage`

The campaign Discord interface shows each registered app, whether D&D is enabled, token-presence status without exposing the token, and every authorized campaign, guild, and scope set.

## Campaign-context resolution

Commands resolve context in this order:

1. Exact binding for the current channel, thread, or forum post.
2. Valid parent-channel binding for a child thread or forum post.
3. Explicit shared-channel active campaign.

When more than one campaign is eligible, Khaos Nexus never guesses. `/campaign use` can select only a campaign already bound to the exact resource or its valid parent.

## Channel, thread, and forum behavior

Bindings support `channel`, `thread`, and `forum_post` resource types with these purposes:

- `main`
- `dm_private`
- `dice_log`
- `character_chat`
- `session_notes`
- `loot`
- `announcements`
- `voice`

Player-safe reads exclude `dm_private` destinations. Deleted resources remain as stale bindings with error state so campaign data and audit history are preserved. Unbinding never deletes the Discord resource.

## Commands

Commands register only when `dnd-workspace` is enabled for the selected app:

- `/campaign info`
- `/campaign use`
- `/campaign panel`
- `/character view`
- `/roll`
- `/initiative view`
- `/initiative join`
- `/initiative next`
- `/session status`
- `/session start`
- `/session end`
- `/quest list`

Campaign owner, DM, or assistant DM authorization is required for management actions. Discord Administrator alone does not grant campaign authority.

## Permissions and RLS

Campaign roles are `admin`, `dm`, `assistant_dm`, `player`, and `viewer`.

- Owner, DM, and assistant DM may manage bindings, grants, explicit channel context, panels, sessions, and attendance.
- Players can read non-sensitive campaign integration information.
- Players cannot read private DM destinations or GM-only campaign records.
- A user can grant only an app they own or are explicitly authorized to manage.
- Discord role mappings are constrained to `viewer` and `operator` and cannot grant Nexus owner/admin.
- Privileged authorization helpers live in a non-exposed `private` schema.
- Public wrappers are security invokers.
- Anonymous/public execution is revoked.
- Service functions may resolve bot interactions without returning credentials.

## Dice privacy

- **Public:** posted normally and persisted.
- **DM only:** shown ephemerally to the roller and delivered to a configured DM destination when available. The response states when delivery failed.
- **Blind:** not generated or persisted unless a safe DM destination is available and delivery succeeds.

The bounded parser supports common notation such as `d20`, `2d6+3`, `2d20kh1+5`, and `2d20kl1`. Input is never evaluated as code. Persistence retains individual dice, kept indexes, modifier, total, normalized expression, privacy, parser version, Discord context, and interaction ID. Interaction IDs are unique per registered app.

## Initiative

Initiative order is deterministic: initiative descending, Dexterity descending, then stable combatant ID. The order is not destructively rotated. `current_turn_index` advances through the stable order, and the round increments only after the final combatant completes a turn.

Players may join using a selected character. Only campaign owner, DM, or assistant DM may advance turns.

## Session lifecycle

Only one active session is allowed per campaign.

Starting a session:

- Activates a selected or planned session.
- Optionally resets active initiative only after explicit confirmation.
- Refreshes the persistent campaign panel.
- Posts one compact session-start response.

Ending a session:

- Marks the session completed.
- Preserves rolls, attendance, encounters, and initiative history.
- Creates an unapproved structured recap draft from Nexus-recorded activity only.
- Never scrapes arbitrary Discord history.
- Never publishes the recap without DM approval.
- Refreshes the campaign panel.

## Persistent campaign panel

Each binding has one panel record and one editable Discord message. Refresh edits the existing message. A deleted message is replaced once and the replacement ID is retained.

The content hash includes stable campaign, party, quest, location, and session data. Audit and refresh timestamps are excluded so unchanged panels are not edited unnecessarily.

## Deployment requirements

1. Apply the ordered database migrations to the verified Khaos Nexus Supabase project.
2. Run Supabase security and performance advisors.
3. Run focused D&D tests, the full test suite, syntax/type checks, and the production build.
4. Configure each Discord application token through protected desktop storage.
5. Invite each bot with `bot` and `applications.commands` plus only the channel/thread permissions it needs.
6. Restart the supervised desktop Discord runtime so module-gated commands register.
7. Grant campaign scopes, bind resources, test access, and refresh the persistent panel.

The current application has no cloud interaction router. Deploying a Supabase Edge Function as a second Discord router or command-registration authority requires a separate approved architecture decision and Discord Bot Core handoff.

## Known limitations

- The desktop foundation is local-first; automatic Supabase-to-desktop synchronization is not part of this foundational phase.
- Registered apps require protected credentials on the installation running them.
- Resource listing verifies visibility; actual message/thread write permission is exercised by resource creation or panel refresh.
- Full campaign category creation is intentionally unavailable.
- D&D Beyond remains link-only or user-controlled import unless an authorized public/partner API or permitted export path exists.
- Paid rulebook text is not included or reproduced.

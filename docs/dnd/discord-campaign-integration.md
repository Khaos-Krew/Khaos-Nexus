# D&D Discord Campaign Integration

## Status and architecture

This feature extends the existing local-first Khaos Nexus desktop application. It does not replace the supervised Discord runtime, Discord Studio, encrypted credential storage, module registry, audit log, or existing game-server commands.

The D&D module is a first-class `dnd-workspace` module. Nexus Bot and additional registered Discord apps run the same D&D command definitions, campaign-context resolver, grants, scopes, dice privacy rules, initiative rules, and session lifecycle.

The desktop remains authoritative for active Discord gateway interactions. Supabase stores the optional multi-tenant shared-data model and RLS boundaries. The migration intentionally contains no bot-token column. Bot tokens remain protected by Electron `safeStorage` on the installation that runs each bot.

## Existing behavior preserved

- Existing Nexus Bot configuration and token remain valid.
- Existing non-D&D slash commands remain registered through the original module gates.
- Existing Discord Automation and persistent game status panels continue to run through `bot/entry.cjs`.
- Existing local backups include the encrypted secret blob and D&D local configuration.
- Existing campaigns and local D&D records are normalized in place rather than deleted when the module is disabled.

## Schema

The migration `supabase/migrations/20260731221500_dnd_discord_campaign_integration.sql` creates the tenant, registered-app, campaign, content, character, encounter, session, roll, binding, grant, context, panel, and audit foundations.

Core Discord integration tables:

- `discord_registered_apps`: safe app metadata only; never stores tokens.
- `discord_app_managers`: users explicitly authorized to manage an app.
- `dnd_discord_bindings`: campaign-to-channel/thread/forum-post bindings.
- `dnd_bot_campaign_grants`: campaign and guild scopes for one registered app.
- `dnd_shared_channel_contexts`: explicit active campaign for a shared channel.
- `dnd_campaign_panels`: one persistent message per binding.
- `dnd_session_attendance`: attending, maybe, unavailable, or late.

Database constraints prevent duplicate active bindings and more than one active primary `main` binding per campaign, registered app, and guild.

## Setup flow

The default setup mode is **Do not create anything**. Saving that mode performs no Discord REST request and creates no Discord resource.

Supported modes:

1. Do not create anything.
2. Assign an existing text channel.
3. Assign an existing thread.
4. Assign an existing forum post.
5. Create one thread in an explicitly selected parent text channel.
6. Create one forum post in an explicitly selected forum.

Thread and forum-post creation require an explicit confirmation. Each operation creates at most one Discord resource. Category creation and full campaign server scaffolding are unavailable.

Manual Discord IDs are supported when synced guild/channel data is unavailable. Enable Discord Developer Mode, then use **Copy Server ID**, **Copy Channel ID**, or **Copy Link** as appropriate.

## Registered-bot authorization

A registered app must:

- Be enabled.
- Have the `dnd-workspace` module enabled.
- Have a protected token on the desktop installation running it.
- Have a campaign grant for the campaign and guild.
- Have every required D&D scope.
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

Nexus Bot is represented as the legacy registered-app record and uses the same D&D routing. Its Discord application ID is read from configuration; no production Discord ID is hardcoded.

## Campaign-context resolution

Commands resolve campaign context in this order:

1. Exact binding for the current channel, thread, or forum post.
2. Valid parent binding for a child thread or forum post.
3. Explicit shared-channel active campaign.

When multiple campaigns share the exact channel or its parent, `/campaign use` must explicitly select an active campaign. Khaos Nexus never chooses one implicitly.

## Channel, thread, and forum behavior

Bindings support `channel`, `thread`, and `forum_post` resource types and these purposes:

- `main`
- `dm_private`
- `dice_log`
- `character_chat`
- `session_notes`
- `loot`
- `announcements`
- `voice`

Players do not receive private DM destination details through the public binding RPC. Deleted resources remain as stale bindings with an error status so campaign data and audit history are preserved.

## Commands

Commands are registered only when `dnd-workspace` is enabled for the running app:

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

DM-only commands require the campaign role `admin`, `dm`, or `assistant_dm`; Discord Administrator alone is not campaign authorization.

## Permissions and scopes

Campaign roles are `admin`, `dm`, `assistant_dm`, `player`, and `viewer`. Campaign owner, DM, and assistant DM may manage Discord integration records. Players can read non-sensitive campaign integration information through safe views/RPCs but cannot see `dm_private` destinations.

Security-definer helper functions use a fixed search path, revoke execution from `public` and `anon`, and grant only to `authenticated` and `service_role` where required. Discord role mappings are constrained to `viewer` and `operator`; they cannot grant Nexus owner or administrator privileges.

## Dice privacy

- **Public:** visible in the command channel and persisted.
- **DM only:** shown ephemerally to the roller and delivered to an authorized DM destination when available. The response states when DM delivery failed.
- **Blind:** the roll is not generated or persisted until a safe DM destination is verified and delivery succeeds.

Dice expressions use a bounded parser. User input is never executed as code. Individual dice, kept indexes, modifier, total, normalized expression, parser version, Discord context, and interaction ID are retained. Interaction IDs are unique per registered app to prevent duplicate persistence.

## Initiative

Initiative order is deterministic: initiative descending, Dexterity descending, then stable combatant ID. The stored order is not destructively rotated. `current_turn_index` advances through the sorted order, and the round increments only after the final combatant completes a turn.

Players may join using a selected character. Only campaign owner, DM, or assistant DM may advance turns.

## Session lifecycle

Only one active session is allowed per campaign.

Starting a session:

- Activates a planned session or creates the selected active record.
- Optionally resets active initiative only after explicit confirmation.
- Refreshes the persistent panel.
- Posts one compact session-start message.

Ending a session:

- Marks the session complete.
- Preserves rolls, attendance, encounter state, and initiative history.
- Creates an unapproved structured recap draft from Nexus-recorded activity only.
- Does not scrape arbitrary Discord history.
- Does not publish the recap without DM approval.
- Refreshes the campaign panel.

## Persistent campaign panel

Each binding has at most one panel row and one editable Discord message. Refresh edits the existing message. A missing/deleted message is replaced once and the new message ID is retained.

The hash uses stable campaign, party, quest, location, and session data. Audit timestamps and refresh timestamps are not included, preventing unnecessary Discord edits.

## Deployment requirements

1. Apply the database migration to the verified Khaos Nexus Supabase project.
2. Run Supabase security and performance advisors.
3. Build and test the desktop branch.
4. Configure each Discord application token through protected desktop storage.
5. Invite each bot with `bot` and `applications.commands` and only the channel/thread permissions it needs.
6. Start or restart the supervised desktop Discord runtime so module-aware commands register.
7. Bind campaigns and grant scopes from the campaign Discord tab.
8. Test access and refresh the persistent panel.

The existing application uses a supervised Discord gateway runtime. A separate cloud interaction webhook or cloud command-registration authority must not be deployed without an approved architecture decision because it would create a second command/router owner.

## Known limitations

- The desktop foundation is local-first. Supabase shared records are not yet synchronized into the desktop local store automatically.
- Registered apps require their protected token on the installation that runs them.
- Discord permission checks can verify resource visibility immediately; actual message/thread permissions are also exercised when creating or refreshing a panel.
- Full campaign category creation is intentionally unavailable.
- D&D Beyond content is link-only or user-controlled import unless a documented authorized API or export path permits more.
- Paid rulebook text is not included by this feature.

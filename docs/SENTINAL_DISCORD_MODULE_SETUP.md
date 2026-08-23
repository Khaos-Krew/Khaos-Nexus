# Nexus Sentinal — Discord Game Module Setup

## Goal

Game modules are backend-first. Nexus Sentinal is the normal Discord surface, and the desktop app remains administration/management only.

## Initial setup

1. Start Nexus Backend and Nexus Sentinal.
2. Invite or re-authorize Nexus Sentinal with the Discord **Administrator** permission. This is the supported permission model for module setup, channel reconciliation, and temporary voice-lobby management.
3. Use the `bot` and `applications.commands` OAuth2 scopes when authorizing the application. Administrator corresponds to the Discord bot permission value `8`.
4. Run `/nexus setup` in Discord.
5. Choose a game module.
6. Either choose an existing Discord category or press **Create Default Category**.
7. Sentinal reconciles the category, creates any missing module channels, creates the module's **Join to Create** voice channel, and publishes/reconciles the module console when that module uses Sentinal as its surface.

Sentinal checks its own guild permissions. If Administrator is missing, setup stops with a clear re-authorization message instead of partially creating Discord structure. `/nexus modules` also reports whether Administrator is ready.

Running `/nexus setup` again is safe. Existing matching channels are reused; missing channels are recreated instead of blindly duplicating the layout.

## Setup authorization

The bot itself is expected to have **Administrator**. That is separate from who may run Nexus setup. The setup wizard remains restricted to the configured Nexus owner or a Discord member with **Manage Server** permission so ordinary members cannot restructure the server.

## Join-to-build voice lobbies

Each installed game module receives a voice channel similar to:

`➕ Join to Create Division Lobby`

When a member joins it, Sentinal creates a temporary voice channel inside the same game category and moves that member into the new lobby. If that member already owns an active temporary lobby for that module, Sentinal returns them to the existing lobby instead of creating another one.

Temporary lobbies are removed automatically when empty. The default maximum is 20 active temporary lobbies per module and can be changed with `discord.maxTemporaryLobbiesPerModule` in `config.json`.

## Persistent state

Discord category/channel bindings, console message IDs, temporary lobby ownership, hosted provider configuration, encrypted provider credentials, and hosted provider validation evidence must share persistent storage.

By default, Sentinal stores these files in the repository/runtime `data` directory. In the Railway image that resolves to `/app/data`, so the current Railway service mounts its persistent volume at `/app/data` and does not need a `NEXUS_DATA_DIR` override.

On another container host, either mount the persistent volume at the runtime's default `data` directory or set `NEXUS_DATA_DIR` to the mounted path, for example:

`NEXUS_DATA_DIR=/data`

When `NEXUS_DATA_DIR` is set, both `sentinal-state.json` and the hosted provider files (`hosted-provider-config.json` and `hosted-runtime-config.json`) use that same directory. The volume mount and `NEXUS_DATA_DIR` must therefore point to the same persistent location.

Without persistent storage, a fresh container can lose saved Discord topology, console bindings, role-menu state, and hosted provider configuration.

## Module layouts

Current defaults include:

- ARK: console, info, LFG
- Palworld: console, info, LFG
- Minecraft: console, modpack, LFG
- Warframe: hub, builds, LFG, market
- The Division 2: hub, builds, LFG, farming
- Rust: console, info, LFG
- Satisfactory: console, factory planning, LFG
- IdleOn: hub, builds, goals
- Nexus D&D: Veyra hub, character builds, campaign LFG; Veyra remains the interactive D&D surface

The layouts are centralized in `src/sentinel/module-layouts.cjs` so future games can be added without rebuilding the desktop UI.

# Nexus Sentinal — Discord Game Module Setup

## Goal

Game modules are backend-first. Nexus Sentinal is the normal Discord surface, and the desktop app remains administration/management only.

## Initial setup

1. Start Nexus Backend and Nexus Sentinal.
2. Make sure the bot has **View Channels**, **Send Messages**, **Embed Links**, **Read Message History**, **Manage Channels**, **Connect**, and **Move Members** in the server/category where modules will be installed.
3. Run `/nexus setup` in Discord.
4. Choose a game module.
5. Either choose an existing Discord category or press **Create Default Category**.
6. Sentinal reconciles the category, creates any missing module channels, creates the module's **Join to Create** voice channel, and publishes/reconciles the module console when that module uses Sentinal as its surface.

Running `/nexus setup` again is safe. Existing matching channels are reused; missing channels are recreated instead of blindly duplicating the layout.

## Join-to-build voice lobbies

Each installed game module receives a voice channel similar to:

`➕ Join to Create Division Lobby`

When a member joins it, Sentinal creates a temporary voice channel inside the same game category and moves that member into the new lobby. If that member already owns an active temporary lobby for that module, Sentinal returns them to the existing lobby instead of creating another one.

Temporary lobbies are removed automatically when empty. The default maximum is 20 active temporary lobbies per module and can be changed with `discord.maxTemporaryLobbiesPerModule` in `config.json`.

## Persistent state

Discord category/channel bindings, console message IDs, and temporary lobby ownership are stored in `sentinal-state.json`.

For Railway or another container host, mount persistent storage and set:

`NEXUS_DATA_DIR=/data`

Without persistent storage, a fresh container can lose the saved Discord topology and Sentinal will need `/nexus setup` again.

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

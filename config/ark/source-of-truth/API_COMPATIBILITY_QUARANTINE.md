# Sentinel ArkAPI Compatibility Quarantine

Sentinel owns runtime compatibility safety for ArkAPI/AsaApi and managed ASA API plugins.

This policy is deliberately separate from ARK INI management. It may change loader/plugin runtime state automatically to protect server availability, but it may not rewrite `Game.ini` or `GameUserSettings.ini`.

## Automatic decision flow

When Sentinel detects a new ARK server build:

1. Compare the build with the last compatibility-approved build.
2. Snapshot the currently enabled ArkAPI/plugin manifest.
3. If ArkAPI compatibility is unknown or incompatible, enter **API Bypass** before the next managed server start.
4. If ArkAPI is compatible but one or more plugins are unknown/incompatible, enter **Plugin Quarantine** and load only the verified allow-list.
5. If the full required stack is verified, use **Normal** mode.

Sentinel should always prefer the smallest safe intervention. A broken ArkShop, AAT, or other individual plugin should not force ArkAPI itself off when the loader is proven healthy.

## API Bypass

`api_bypass` means the ArkAPI loader is disabled through the host/provider-neutral pre-start adapter before ASA launches.

Because NexusARK itself is an ArkAPI plugin, NexusARK cannot perform this action from inside the game process. Sentinel must make the decision externally.

Use API Bypass when:
- a new ARK build is detected and ArkAPI compatibility is still unknown;
- ArkAPI is known incompatible;
- ArkAPI causes startup crashes, restart loops, or an independent RCON/server-health regression.

## Plugin Quarantine

`plugin_quarantine` keeps ArkAPI enabled and loads only plugins in the verified known-good manifest.

Unknown or failing plugins remain disabled until validation. Restore one plugin at a time so a single bad plugin can be identified and re-quarantined without taking down the rest of the API stack.

## Recovery

Astraeos is the compatibility canary.

Production restoration requires:
- ArkAPI compatible with the current ARK build;
- required plugin versions compatible;
- at least two healthy Astraeos managed restarts;
- server online health passing;
- RCON health passing;
- ArkAPI/plugin health passing when those components are enabled.

If a restoration attempt fails, Sentinel returns to the previous safe mode and records the failure instead of repeatedly restarting the server.

## Notifications

Warnings cannot rely only on AAT because AAT may be quarantined with the rest of the API plugin stack.

Preferred transport order:
1. Sentinel directly posts to the Discord cluster-chat/crosschat channel.
2. Sentinel broadcasts in-game using RCON when available.
3. AAT may mirror the notice only when it is healthy.

Staff detail should include the map/server, old/new ARK build, ArkAPI version, selected runtime mode, affected plugins, reason, health evidence, and current recovery state.

## Source-of-truth boundary

Git stores the compatibility policy and approved compatibility data. Sentinel stores protected live state/audit evidence. The game server is never authoritative and does not write discovered settings back into Git automatically.

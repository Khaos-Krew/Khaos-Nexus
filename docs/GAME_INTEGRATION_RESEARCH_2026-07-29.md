# Khaos Nexus Game Integration Research

**Research date:** 2026-07-29  
**Purpose:** identify popular multiplayer games that can be integrated without pretending unsupported host access or unsafe client-side control exists.

## Evaluation method

Candidates were ranked by:

1. active community and dedicated-server demand;
2. availability of a documented remote protocol, server API, query interface, console or reliable log/config surface;
3. compatibility with hosted servers where the user may only receive a panel API, RCON/Telnet credential or read-only query port;
4. ability to reuse Khaos Nexus protections: encrypted credentials, typed actions, owner/operator roles, status panels, scheduler, backups and audit history;
5. maintenance risk when the game updates.

Current player-count snapshots are only demand signals. They change constantly and should not be treated as permanent rankings.

## Recommended implementation order

### Tier 1 — strongest next integrations

#### 1. Rust

**Why it belongs first:** Rust remains one of the largest dedicated-server survival communities, and Facepunch documents WebRCON, query ports, log output and the Rust+ companion server.

**Transport:** WebRCON/WebSocket, Steam query, optional Rust+ companion connection.

**Useful Khaos Nexus features:**

- status, players, queue and server performance;
- broadcast, kick, ban, mute and owner/moderator commands;
- wipe schedule and map/seed information;
- scheduled warnings, saves and host restart verification;
- Discord status panel and moderation audit;
- optional Rust+ event/notification bridge after protocol review.

**Risk:** commands and plugin-enhanced data vary between vanilla and uMod/Oxide servers. The first adapter should remain vanilla-safe.

**Primary sources:**

- Facepunch server setup and WebRCON: https://wiki.facepunch.com/rust/Creating-a-server
- Rust+ companion server: https://wiki.facepunch.com/rust/rust-companion-server

#### 2. Satisfactory

**Why it belongs near the top:** the dedicated server has an official HTTPS management API, making this one of the cleanest secure integrations.

**Transport:** TLS HTTPS API at `/api/v1`, plus lightweight query availability checks.

**Useful Khaos Nexus features:**

- server state, session name and player information;
- claim/authentication workflow and protected API token storage;
- save creation, save loading and shutdown controls where supported;
- health/performance dashboard;
- Discord status panel and scheduled backup/export workflows.

**Risk:** certificate validation and self-signed server certificates must be handled explicitly; no global insecure-TLS bypass.

**Primary source:** https://satisfactory.wiki.gg/wiki/Dedicated_servers/HTTPS_API

#### 3. Minecraft Bedrock Dedicated Server

**Why it belongs near the top:** Minecraft has enormous community reach, Bedrock Dedicated Server is officially supported on Windows and Ubuntu, and Microsoft is expanding dedicated-server administration and scripting APIs.

**Transport:** server console/process adapter for self-hosted servers; official Bedrock server-admin/script APIs for a server-side behavior-pack bridge; hosted-panel adapter where available.

**Useful Khaos Nexus features:**

- server status, version, world and allowlist;
- player join/leave feed and Discord status;
- allowlist/operator management;
- scheduled save/stop and backup workflows;
- optional server-side bridge for typed remote commands and events.

**Risk:** Bedrock experimental APIs can change. The base module should use stable console/config operations, with experimental bridge features behind a separate switch.

**Primary sources:**

- Bedrock Dedicated Server setup and console: https://learn.microsoft.com/en-us/minecraft/creator/documents/bedrockserver/getting-started
- Dedicated server administration APIs: https://learn.microsoft.com/en-us/minecraft/creator/scriptapi/minecraft/server-admin/dedicatedserverutils
- Bedrock scripting for external services: https://learn.microsoft.com/en-us/minecraft/creator/documents/bedrockserver/scripting

#### 4. 7 Days to Die

**Why it belongs near the top:** it has a large survival-server community and exposes a Telnet administration interface, web control panel settings, server logs, player commands and `serveradmin.xml` permissions.

**Transport:** authenticated Telnet, optional web control panel/query, log parser.

**Useful Khaos Nexus features:**

- status, player IDs and game time;
- broadcast, kick, ban, whitelist and admin permissions;
- scheduled blood-moon/restart warnings;
- save/shutdown workflow and log-based restart verification;
- Discord player/status panel and moderation history.

**Risk:** Telnet is plaintext. Khaos Nexus should require local/private-network use or an explicitly configured secure tunnel; it should warn against exposing Telnet directly to the public internet.

**Primary sources:**

- Official server configuration: https://7daystodie.wiki.gg/wiki/Server
- Telnet and serverconfig properties: https://7daystodie.wiki.gg/wiki/Server:serverconfig.xml
- Administration and command permissions: https://7daystodie.wiki.gg/wiki/Server:serveradmin.xml

### Tier 2 — high-value RCON integrations

#### 5. DayZ

**Transport:** BattlEye RCon over its dedicated port.

**Features:** players, GUID/ping, broadcast, kick, temporary/permanent bans, ban-list reload/write, admin sessions and audit history.

**Risk:** BattlEye RCon uses a different protocol from Source/Minecraft RCON and needs its own hardened client with UDP timeout/replay handling.

**Primary sources:**

- Bohemia server configuration: https://community.bohemia.net/wiki/DayZ:Server_Configuration
- BattlEye RCon commands/protocol entry: https://www.battleye.com/support/documentation/

#### 6. Project Zomboid

**Transport:** RCON plus server logs/configuration.

**Features:** player list, server message, kick/ban/unban, whitelist, access level, save/quit and scheduled restart workflow.

**Risk:** Build 42 server behavior and command output should be captured from an SDK/server dump before promising exact parsing. Implement behind a protocol compatibility test and version profile.

**Research sources:**

- Official PZwiki project/server documentation: https://pzwiki.net/
- Existing Node RCON command surface used as a protocol cross-check: https://www.npmjs.com/package/project-zomboid-rcon

#### 7. V Rising

**Transport:** Source-style RCON configured in `ServerHostSettings.json`.

**Features:** announcements, restart warnings, status/query, configuration viewer, save/config backup and Discord status.

**Risk:** Stunlock describes the built-in RCON command set as limited. Advanced moderation should not depend on community mods unless a separate mod-assisted adapter is explicitly enabled.

**Primary source:** https://github.com/StunlockStudios/vrising-dedicated-server-instructions

#### 8. Factorio

**Transport:** RCON and optional Lua/mod-generated structured output.

**Features:** player/status information, server messages, saves, map/version/mod inventory, scheduled restarts, production alerts and optional factory telemetry through a server mod.

**Risk:** rich telemetry requires controlled Lua/mod code. Vanilla-safe RCON administration and mod-assisted telemetry should be separate module capabilities.

**Primary sources:**

- Official headless builds: https://wiki.factorio.com/Download_API
- Official Lua RCON interface: https://lua-api.factorio.com/latest/classes/LuaRCON.html

#### 9. Conan Exiles

**Transport:** Minecraft-compatible RCON, server logs and configuration files.

**Features:** status, broadcast, player moderation, restart scheduling, configuration/backup management and Discord status.

**Risk:** command coverage varies and must be discovered against the current Enhanced Edition server before exposing typed actions.

**Research source:** https://conanexiles.fandom.com/wiki/Rcon

### Tier 3 — monitor-first or host-panel-first integrations

#### 10. Valheim

**Transport:** Steam query, logs, admin/banned/permitted files, process or hosting-panel power controls.

**Features:** online/player count, world/name/version, join/leave events, allow/ban files, backup and host restart scheduling.

**Risk:** vanilla Valheim lacks a broad authenticated remote administration API. Hosted-panel integration or a separately approved server-side mod is needed for richer controls.

#### 11. Enshrouded

**Transport:** Steam query, JSON configuration, logs and hosting-panel controls.

**Features:** server online state, slots, configuration editor, log health, save backup and host-managed restart.

**Risk:** official documentation exposes configuration/log/query surfaces but not a full remote admin API. Start as read-only monitoring plus protected hosted-server power controls.

**Primary sources:**

- Dedicated-server configuration: https://enshrouded.zendesk.com/hc/en-us/articles/16055441447709-Dedicated-Server-Configuration
- Dedicated-server FAQ and log/startup indicators: https://enshrouded.zendesk.com/hc/en-us/articles/16056312924957-Dedicated-Server-FAQ

#### 12. Terraria / TShock

**Transport:** vanilla console for local servers; TShock REST API for explicitly modded servers.

**Features:** status, players, broadcasts, moderation, whitelist and scheduled saves/restarts.

**Risk:** TShock is not vanilla. Khaos Nexus must label this as a mod-assisted adapter and never assume the REST API exists.

## Existing modules that should remain first-class

Khaos Nexus already has direct support foundations for:

- Palworld REST and legacy RCON;
- ARK RCON;
- generic Source/Minecraft-style RCON;
- Pterodactyl hosting panels.

Those should be refactored into a common adapter contract before adding several games at once:

- `status()`
- `players()`
- `announce()`
- `save()`
- `kick()`
- `ban()` / `unban()`
- `shutdown()`
- `capabilities()`
- `health()`

Every adapter should declare capabilities rather than making the UI guess from the game name.

## Recommended next build sequence

1. **Game Adapter SDK** — typed capability manifest, common error model, test fixture recorder and redacted protocol diagnostics.
2. **Rust module** — WebRCON, status, players, moderation, schedule and Discord panel.
3. **Satisfactory module** — certificate-aware HTTPS API and save/session controls.
4. **7 Days to Die module** — private-network Telnet with explicit plaintext warnings.
5. **Minecraft Bedrock module** — stable console/config adapter first; optional server-side API bridge second.
6. **DayZ BattlEye RCon** — separate UDP protocol implementation.
7. Add V Rising, Factorio and Project Zomboid after fixture captures confirm current command behavior.

## Security requirements for every future adapter

- protected credentials remain in OS encryption storage;
- no secrets in renderer state, logs, diagnostics or Discord;
- owner/operator/viewer access policy per action;
- explicit capability detection before enabling controls;
- TLS certificate pinning or clear trust enrollment for HTTPS APIs;
- no public exposure of plaintext Telnet;
- request timeouts, rate limits and bounded retries;
- safe save-before-shutdown behavior;
- audit record for every destructive action;
- module switch capable of immediately blocking desktop and Discord operations.

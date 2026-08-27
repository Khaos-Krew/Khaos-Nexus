# Khaos Nexus — Overnight Production Audit — 2026-08-27

Status: **ACTIVE AUDIT SNAPSHOT**  
Repository: `Khaos-Krew/Khaos-Nexus`  
Branch: `rebuild/nexus-0.1`  
Previous report baseline: `83002409e76987ae584dc30e78bd7048cd518710` (2026-08-26 7 AM report)

## Executive state

The active branch advanced by 50 commits after the previous report before this audit began. The changes are concentrated in the hosted-server directory/manager, server applications and host titles, live server status providers, Once Human setup guidance, Shadow Recruit baseline behavior, and Discord server-directory UX.

The branch tip immediately before this audit (`e8dadc95dd84c8c61abe2d889a8bc45219eaaa19`) was **not deployed** because Railway CI failed on two stale `#game-servers` test fixtures after the new popup-application UI was added. The failures were not runtime logic failures: one assertion expected superseded policy wording and one idempotency fixture omitted the new application button component.

Audit fix commit `e9d26d238ce65a65d6bee883cf06b118f99b7f07` corrected those test contracts. Railway then passed **674 tests / 667 passed / 0 failed / 7 skipped**, deployed successfully, started Backend and Sentinal, logged into Discord, and re-registered `/server`.

## Completed since the previous report

- Hosted-server storage/directory was expanded to a v5 model supporting arbitrary games, official vs approved-community ownership, listing lifecycle, public/private paid-rank access, external IDs, scenarios/regions, protected join/admin data, runtime health metadata, offline lifecycle fields, and server-host ownership metadata.
- Community-server application storage and review flow were added, then simplified into a private popup form rather than a chat-style application flow.
- `#game-servers` was expanded into an official/community directory with a persistent rules card and **List My Server** button.
- Server Host title aggregation and Community Level progression support were added.
- Hosted-server status probing now includes Nitrado API telemetry, direct Palworld REST, direct Palworld RCON, and manual providers, with Nitrado retry/backoff/circuit-breaker behavior.
- Once Human setup guidance was added as an official-dashboard/manual-management path rather than undocumented NetEase endpoint automation.
- The deployment-blocking server-directory test regressions found in this audit were repaired and the current head is now live.

## P0 — Production acceptance and correctness

### 1. Real hosted-server acceptance is still not proven

Code, tests, and command registration are live, but this audit did not locate live evidence proving that the actual Palworld and Once Human registrations have both been created, persisted across a restart, refreshed, and rendered correctly in `#game-servers` with real provider state.

**Required acceptance:** register the real servers, restart/deploy once, verify `/server list`, `/server status`, `/server setup`, and `#game-servers`, and confirm no private host, port, token, password, invitation secret, service ID, or admin note leaks into public Discord surfaces.

### 2. Nitrado provider control and Palworld game protocol are currently conflated

`HostedServerStatusService` contains a working `nitrado-api` status path, but the current `/server configure` UI exposes only **REST API, RCON, Manual, or None**. The v5 store maps those connection types to `palworld-rest`, `palworld-rcon`, `manual`, or `none`; it does not provide a normal current configuration path that selects `nitrado-api` and its Nitrado service ID.

This makes the Nitrado API path effectively legacy/dead from the normal Discord setup flow even though the probe implementation exists.

**Recommended correction:** split the model into two independent layers:

- **Hosting control provider**: Nitrado API / manual host dashboard / future providers.
- **Game management protocol**: Palworld REST / deprecated RCON / none.

This allows Nitrado service status/start-stop-backup operations to coexist with a private Palworld REST channel without pretending they are the same connection.

### 3. Palworld REST must not be exposed directly to the public Internet

Pocketpair's current official Palworld server documentation marks REST as the preferred management API and requires `RESTAPIEnabled=True`; it uses Basic Auth and explicitly warns that the API is **not designed to be exposed directly to the Internet**. The official RCON documentation marks RCON **deprecated** and says it is planned for removal in a future update.

The Nexus Palworld REST client currently uses plain HTTP as the official protocol expects. Therefore a Railway-hosted Sentinel must not require the owner to publicly expose port 8212 just so Railway can reach it.

**Preferred order:**

1. Nitrado API for host/service-level telemetry and supported host controls.
2. Palworld REST for game-level telemetry/admin only through a trusted/private route, Nitrado-supported internal route, or hardened proxy/tunnel.
3. RCON only as a compatibility fallback while it still works; mark it deprecated in `/server setup` and do not build new core features that depend exclusively on it.

Official Palworld REST documentation: https://docs.palworldgame.com/api/rest-api/palwold-rest-api/  
Official Palworld RCON documentation: https://docs.palworldgame.com/ja/api/rcon/

## P1 — Live defects and regression risks

### Shadow Recruit startup member fetch is rate-limited

The newly deployed runtime logged: `Shadow Recruit member fetch failed: Request with opcode 8 was rate limited` with an approximately 11-second retry delay. This is the same class of Discord startup pressure Nexus previously removed from other acceptance/reconciliation paths.

**Fix:** do not issue an unconditional full guild member fetch during startup. Prefer cache/event-driven role maintenance, bounded targeted fetches, or queue/coalesce the operation behind the existing member-reconciliation budget. Add a regression test that startup does not require an opcode-8 full member request.

### Warframe world-state provider still produces repeated HTTP 404 errors

The current successful deployment again emitted 404 provider errors for news, events, alerts, sortie, arbitration, Nightwave, Void Trader, and Steel Path.

**Fix:** validate the provider route contract, distinguish endpoint removal from transient failure, cache the last-good snapshot, back off repeated identical failures, and collapse one upstream outage into a single incident rather than eight noisy errors per sweep.

### Server directory is regression-sensitive after rapid UI expansion

Three consecutive deployments failed before this audit because test fixtures did not evolve with the popup application UI. The corrected test now models the button component, but future component/embed revisions need migration/idempotency tests intentionally separated into:

- old canonical panel -> exactly one upgrade edit;
- current canonical panel -> zero edits;
- duplicates -> newest current panel retained and extras removed.

## P1 — Once Human Custom Server configuration gap analysis

The repository's current `once-human-custom-server-config.cjs` is a useful category-level guide, but it is too coarse to function as a real configuration profile manager and it is already behind the official August 24, 2026 feature surface.

### Current official capabilities Nexus should model

**Identity and access**
- Server name/introduction, capacity, unlocked/public vs invitation-code access.
- Scenario selection and gameplay mode; scenario phase duration controls and reusable scenario templates.

**World, survival, and progression**
- Weather and day/night behavior, character/progression modifiers, resource distribution/respawn behavior, survival pressure, and scenario-specific progression controls.
- Weapon and armor durability-loss settings (added June 10, 2026).

**Territory and building**
- Separate territory quantity limits for **host, administrators, and regular members: 1–100 each**.
- Server-wide territory cap increased to **5,000**.
- Permission for members to place Custom Server-exclusive buildings.
- Custom Server-exclusive preset buildings including large environment/facility structures.
- Existing expanded construction controls such as overlap/floating/restricted-area building where exposed by the selected mode/version.

**Host/admin controls**
- Assign administrators, moderate/remove players, and existing character-data management controls.
- August 24 added the ability for the host to **delete members' territories**.
- August 24 added host location sharing in chat with clickable coordinates that other players can use to teleport.
- Host/GM operation guidance and official website entry are now exposed directly from Server Settings.

**Distribution and economy**
- Quick distribution to self/specific players.
- Advanced recipient selection including online, registered, administrators, and specified players.
- Reusable distribution templates and expanded distributable supplies.
- In-Server Shop configuration; hosts can purchase from the In-Server Shop.
- Custom content can be placed into loot crates or the Shop.

**Custom content**
- Custom weapons: base stats, custom traits, bonus effects.
- Custom armor: base stats/effects across survival and damage dimensions.
- Custom food/potion names and effects.
- Custom-content capacity/limit awareness.
- Custom dungeons: dungeon name, enemy difficulty, additional skills, item drops, and access method.

**RaidZone / Hyper Brawl**
- Restricted combat zones, center/radius, spawn/respawn confinement, progression pace and resource distribution.
- Stage configuration with stage duration and safe-zone radius change rules.
- Respawn cooldown controls for Territory Terminals, Sleeping Bags, Beds, and Campsites.
- Adrenaline Shot toggle, facility/material limits, crafting restrictions, broader Deviation availability where supported.
- Kill/online-duration reward definitions, contest objectives, K/D and wealth leaderboards.

Official sources reviewed for this audit:
- Aug 24, 2026 v3.0.4: https://www.oncehuman.game/news/update/20260824/40780_1312014.html
- Aug 5, 2026 v3.0.3: https://www.oncehuman.game/news/update/20260805/40780_1310214.html
- Jul 22, 2026 v3.0.2: https://www.oncehuman.game/news/update/20260722/40780_1308595.html
- Jun 24, 2026 v2.4.3: https://www.oncehuman.game/banner/20260625/41906_1305437.html
- Jun 10, 2026 v2.4.2: https://www.oncehuman.game/news/update/20260610/40780_1303756.html
- May 13, 2026 v2.3.8: https://www.oncehuman.game/banner/20260513/41906_1300125.html
- Apr 22, 2026 v2.3.7: https://www.oncehuman.game/news/update/20260422/40780_1297274.html

### Recommended Once Human implementation

Replace the current list-of-labels guide with a **versioned configuration schema + profile manager**. Each setting should carry: section, key, value type, legal range/choices, scenario applicability, restart requirement, destructive/reset risk, privacy class, source/version first seen, and whether Nexus can automate it or only guide the owner through the official dashboard.

Add saved Nexus profiles and diffing so the owner can maintain presets such as **Balanced PvE**, **Hard Survival**, **Builder Sandbox**, **PvP Event**, and **RaidZone/Hyper Brawl**, then compare a proposed profile against the current recorded configuration before changing the NetEase dashboard.

Until NetEase publishes a supported management API, Nexus should continue to **guide, record, validate, diff, and audit** these settings rather than scrape or reverse-engineer private endpoints.

## P2 — Useful feature opportunities

- Add `/server setup` provider-aware recommendations: Nitrado-hosted Palworld should explicitly show Nitrado control plus REST/RCON game-protocol options and security warnings.
- Add a server acceptance checklist command that reports which pieces are missing: identity, join visibility, provider credential reference, service ID/admin endpoint, live probe, public card, and persistence proof.
- Add status freshness to admin-only server views: last check, last online, offline duration, circuit state, and last provider error class.
- Add Once Human renewal/expiry tracking with reminders; keep it manually supplied until a supported NetEase source exists.
- Add Once Human configuration snapshot history and change-risk labels (`live-safe`, `restart-required`, `scenario-reset-risk`).
- Add a single upstream-provider incident aggregator so repeated Warframe/Nitrado/other provider failures do not flood logs or Discord.

## Owner input / blockers

### Palworld / Nitrado

For full live acceptance Nexus needs the real Nitrado service identifier and a Railway environment-variable **name** containing the Nitrado token if Nitrado API control is enabled. Never place the actual token in Discord/chat or the hosted-server JSON. If direct Palworld REST is used, Nexus also needs a safe private/proxied route to the REST port and an environment-variable name containing `AdminPassword`; public exposure of the raw REST endpoint is not acceptable. RCON should only be configured if REST/private routing is unavailable.

### Once Human

Nexus can build the complete setup/profile surface without a NetEase API, but the final recommended profile depends on owner choices for scenario/game mode, PvE vs PvP emphasis, player capacity, public vs invite-only access, territory allowances, survival difficulty, custom gear/items, shop philosophy, and whether Hyper Brawl/RaidZone features are intended.

## Recommended execution order

1. Prove the real Palworld and Once Human registrations end-to-end on the now-green production build.
2. Split Nitrado host control from Palworld REST/RCON game-protocol configuration; mark RCON deprecated.
3. Remove Shadow Recruit's startup full-member-fetch rate-limit path.
4. Expand Once Human into the versioned configuration/profile schema described above.
5. Repair/quiet the Warframe world-state provider failure pattern.
6. Add provider incident aggregation and server acceptance diagnostics.

## Current deployment evidence

- Audit fix/deploy commit: `e9d26d238ce65a65d6bee883cf06b118f99b7f07`
- Railway deployment: `ac7d239e-9f30-43ee-a414-5fb652bcf3b3`
- Build state: **SUCCESS**
- Test result: **674 total / 667 passed / 0 failed / 7 skipped**
- Runtime: Backend listening, Sentinal Admin listening, Discord login successful, `/server` registered.
- Live errors observed after startup: repeated Warframe world-state HTTP 404s; Shadow Recruit member-fetch Discord rate limit.

This audit intentionally records code presence, automated validation, deployment status, and live acceptance as separate evidence gates.
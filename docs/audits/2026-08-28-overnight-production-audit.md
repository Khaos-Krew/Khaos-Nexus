# Khaos Nexus Overnight Production Audit — 2026-08-28

## Audit baseline

Previous audit baseline: `e9d26d238ce65a65d6bee883cf06b118f99b7f07`

Audited branch: `rebuild/nexus-0.1`

Audited head before this report: `fa72b6ddb709880e9f89bb98f277d8f0f3b289fd`

Repository delta: 154 commits ahead of the previous audit baseline, with no commits behind. The largest change concentration is the ARK companion/admin/economy surface, plus dashboard navigation fixes, hosted-server hardening, provider/status tests, and Sentinel reconciliation work.

## Production state

Latest verified Railway deployment before this audit document commit: `d70dfa85-9be4-4895-9400-e752d1f90b55`, status `SUCCESS`, deploying commit `fa72b6ddb709880e9f89bb98f277d8f0f3b289fd` from `rebuild/nexus-0.1`.

Build test result: 721 tests, 714 passed, 0 failed, 7 skipped.

Sentinel successfully registered the `/server` hosted-server manager in the target Discord guild. Module auto-provision repeatedly reports `provisioned=0`, `blocked=0`, `failed=0`, indicating a stable no-change structural reconciliation state.

## Completed / materially improved since prior report

### Shadow Recruit startup regression

The prior startup rate-limit symptom is not present in the current deployment. Shadow Recruit baseline reconciliation completed at startup and continued periodically with `scanned=15`, `added=0`, `already=15`, `bots=3`, `failed=0`. Treat the previous rate-limit regression as resolved for the current deployment, while retaining monitoring because the implementation still performs periodic scans.

### Hosted-server status hardening

The hosted-server status layer now includes bounded retry/backoff and a circuit breaker for Nitrado status requests, fail-closed behavior for missing service IDs/tokens, REST/RCON credential validation, and private credential lookup by environment-variable name. Tests cover Nitrado missing configuration, transient retry, circuit-breaker behavior, and REST/RCON missing credentials.

### ARK subsystem expansion

ARK received the overwhelming majority of the recent functional expansion: broader species/taming data, passive/instant-tame handling, breeding and mutation workflows, convenience/setup guidance, companion interaction routing, shop-plan/economy additions, restart scheduling, config safety/rollback behavior, and substantially larger test coverage. The current production build is green after this expansion.

### Dashboard/navigation repairs

Recent commits repaired dashboard actions that pointed at incomplete/empty destinations and aligned homepage action tests with the navigation chain. These changes remove a class of dead-end UI regressions observed during prior work.

## Priority findings

### P0 — Palworld/Nitrado connection model is implemented internally but not exposed correctly in `/server configure`

`HostedServerStatusService` supports three relevant Palworld adapters: `nitrado-api`, `palworld-rest`, and `palworld-rcon`. It maps legacy `nitrado-palworld` to `nitrado-api`, reads the Nitrado service ID from `adapterRef/providerRef`, and reads the API token only from the configured environment-variable reference.

However, the Discord `/server configure` command exposes only `REST API`, `RCON`, `Manual / Host Dashboard`, and `No Live Connection`. It has no Nitrado option and no field for a Nitrado service ID/provider reference. The Palworld setup guide also lists only REST, RCON, or no live connection; `nitradoPalworldSetupGuide()` is currently just an alias to the generic Palworld guide.

This is an integration gap: Nitrado telemetry exists in backend code and tests but cannot be configured through the normal owner/admin workflow.

Recommended fix: split provider configuration into two orthogonal concepts instead of forcing one connection enum to represent both. `hostingProvider = nitrado` should carry a private Nitrado service ID plus an environment-variable token reference; `gameAdminConnection = palworld-rest | palworld-rcon | none` should independently represent game-level administration. This lets Sentinel use Nitrado for host/service health and lifecycle while using Palworld REST only when a safe private route is available. RCON should remain compatibility-only.

Security requirement: never place the Nitrado API token, Palworld AdminPassword, service credentials, private REST endpoint, or RCON password in public Discord fields or logs. Only environment-variable names should be stored in server metadata.

### P0 — Once Human setup guide is broad but not yet a real configuration manager

The Once Human setup service has a useful high-level section catalog covering identity/access, scenario, world, progression, combat, building/survival, tech/social, host/admin, presentation/operations, and advanced customization. It correctly declares management as `manual-official-dashboard` and avoids undocumented private NetEase endpoints.

The remaining gap is depth and statefulness. The guide stores section labels, not typed settings, ranges, scenario applicability, restart/reset risk, source/version provenance, current values, desired values, or diffs. It therefore cannot yet function as the Nexus configuration planner requested for a real purchased Custom Server.

Fresh official Once Human material confirms the configuration surface has continued expanding. The August 24, 2026 update added in-game guidance for Server Host privileges/events/shop, host location sharing with click-to-teleport coordinates, deletion of member territories, a Server Settings website entry, and mobile entries for Custom Server features. The August 5, 2026 update expanded territory configuration and exclusive building controls. Earlier 2026 updates added custom gear/items, RaidZone: Hyper Brawl controls, scenario templates, join announcements, facility/vehicle restrictions, item distribution, leaderboards, and other scenario-specific settings.

Recommended fix: replace the current string-list setup guide with a versioned setting registry. Each setting should define a stable key, label, value type, range/choices, category, scenario applicability, privacy class, restart requirement, progression/reset risk, source version/date, and notes. Add saved profiles, current-vs-target snapshots, diffs, validation, and presets such as Balanced PvE, Hard Survival, Builder Sandbox, PvP Event, and Hyper Brawl. NetEase remains the execution layer until a supported public API exists.

### P1 — Warframe provider still creates a log/error storm during transient upstream failure

The latest live deployment produced repeated HTTP 404 errors for Warframe news, events, alerts, sortie, arbitration, Nightwave, Void Trader, and Steel Path across multiple reconciliation passes. Later in the same deployment, those feeds recovered and were successfully reused/updated.

This proves the current defect is not simply a permanently wrong endpoint: transient/provider-state failures can recover, but Sentinel treats each feed independently and emits repeated errors while the provider is unavailable.

Recommended fix: introduce a shared Warframe provider incident state/circuit breaker. Collapse correlated failures into one incident, retain last-known-good feed content, back off provider calls, show data freshness, and emit a single recovery event when service returns. Do not delete or blank existing Discord feed cards during a transient provider incident.

### P1 — ARK expansion needs an end-to-end acceptance pass despite green unit tests

The 154-commit delta contains a disproportionately large ARK change surface. Green tests materially reduce regression risk, but the interaction layer, large species/taming dataset, config/economy paths, restart scheduler, and multiple Discord component flows now warrant focused live acceptance.

Recommended acceptance: exercise every ARK companion button/modal path in Discord, validate passive/KO/instant-tame edge cases against known creatures, verify pagination/custom IDs do not expire or collide, validate mutation/breeding calculations, confirm shop-plan publication is staff-only where intended, and verify restart warnings/save/restart sequencing on a non-destructive test path before enabling any higher-impact automation.

Data quality risk: broad creature datasets and heuristic/fallback food/taming rules can be logically valid while still being game-inaccurate. Keep an explicit provenance/override mechanism for special creatures and modded content rather than treating generic fallback calculations as authoritative.

### P1 — Provider and deployment acceptance should be a first-class command/smoke gate

The test suite is strong, but current deployment verification still depends heavily on log inspection. Add a non-cacheable deployment smoke gate that checks backend `/health`, Sentinel login, critical slash-command registration, hosted-server registry readability, and one harmless reconciliation pass.

Add `/server acceptance <id>` for staff. It should report configuration completeness without secrets: identity present, provider selected, credential environment variable present, provider reference present, live probe result, public listing safety, freshness, and any missing requirement. This would make real Palworld and Once Human acceptance deterministic.

### P2 — Reconciliation/log cadence can be quieter

Current logs show no-change module auto-provision every ~5 minutes, category reconciliation roughly every 15 minutes, suggestion review every ~5 minutes, and Shadow Recruit baseline roughly every 15 minutes. They are currently successful, but the stable system is spending API/log budget repeatedly proving no change.

Recommended cleanup: retain event-driven reconciliation as primary, apply dirty flags and longer stable intervals, jitter periodic fallbacks, and reduce INFO logging for unchanged passes to debug/summary metrics. Preserve periodic safety reconciliation, but avoid turning healthy steady state into operational noise.

## Palworld/Nitrado implementation direction

Current code should converge on this architecture:

1. Nitrado API = hosting/service plane: service state, lifecycle/host controls where supported, provider-level metadata, and potentially backups/settings metadata only through documented supported operations.
2. Palworld REST = game administration plane: server info/settings/metrics/player list and supported moderation/save/shutdown operations, but only through a trusted/private route.
3. Palworld RCON = deprecated compatibility fallback, not the foundation for new features.

Pocketpair's current Palworld documentation marks RCON deprecated and recommends REST. It also explicitly warns that both APIs are not designed for direct Internet exposure. The REST API requires `RESTAPIEnabled=True` and uses HTTP Basic Auth. Sentinel must therefore not require a publicly exposed REST/RCON port on the Nitrado server.

## Once Human configuration model to build

The next configuration schema should cover at minimum: identity/access and invite mode; capacity; scenario and gameplay mode; phase durations; scenario templates; weather/world rules; survival pressure; combat/PvP controls; durability rules; territory limits by host/admin/member; server-wide territory cap; exclusive building permissions; facility/vehicle restrictions; Hive/social limits; host/GM/admin privileges; player/character/territory management; announcements; item/reward distribution; In-Server Shop; custom gear/items; custom dungeon controls; RaidZone/Hyper Brawl restricted zones, respawn/resource/crafting/reward/leaderboard controls; presentation/cover/tags where applicable; and lifecycle/renewal metadata.

Every destructive or progression-affecting setting should have a warning class and require explicit owner confirmation in Nexus even though the actual change is made in the official NetEase interface.

## Blockers / owner input needed

Palworld live acceptance requires the Nitrado service ID and the name of the Railway environment variable that contains the Nitrado API token. The raw token must not be sent through Discord/chat or stored in server metadata. Direct Palworld REST additionally requires a safe private route to the REST endpoint and an environment-variable reference for the AdminPassword; do not expose the REST port directly to the Internet.

Once Human profile finalization requires the intended operating profile: scenario, PvE/PvP emphasis, expected player capacity, territory policy, survival difficulty, shop/economy philosophy, and whether RaidZone/Hyper Brawl features will be used. The schema and presets can be built before those choices are supplied.

## Recommended implementation order

1. Fix `/server configure` so Nitrado hosting-provider configuration is actually reachable and independent of Palworld REST/RCON.
2. Add `/server acceptance` and perform real Palworld + Once Human registration/persistence/privacy/status acceptance.
3. Replace Once Human string-list guidance with the versioned typed profile/snapshot/diff system.
4. Add Warframe provider-level incident aggregation, stale-last-good behavior, backoff, and recovery logging.
5. Run focused live acceptance on the expanded ARK companion/economy/restart surfaces.
6. Add non-cacheable post-deploy smoke checks and quiet stable reconciliation/log cadence.

## External references reviewed

- Palworld REST API documentation: https://docs.palworldgame.com/api/rest-api/palwold-rest-api/
- Palworld RCON documentation: https://docs.palworldgame.com/0.6.8/api/rcon/
- Nitrado NitrAPI overview: https://server.nitrado.net/es-ES/news/nitrapi-la-interfaz-de-programacion-de-nitrado-para-ordenar-gestionar-y-controlar-servicios
- Once Human Version 3.0.4 update, August 24, 2026: https://www.oncehuman.game/news/update/20260824/40780_1312014.html
- Once Human Version 3.0.3 update, August 5, 2026: https://www.oncehuman.game/news/update/20260805/40780_1310214.html
- Once Human Custom Server custom gear/items dev blog: https://www.oncehuman.game/news/devBlog/20260507/40781_1299394.html
- Once Human Custom Servers / RaidZone Hyper Brawl update: https://www.oncehuman.game/news/official/20260415/40779_1296153.html

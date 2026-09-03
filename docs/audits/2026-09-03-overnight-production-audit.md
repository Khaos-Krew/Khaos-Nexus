# Khaos Nexus Overnight Production Audit — 2026-09-03

## Scope
Audit of `rebuild/nexus-0.1` since the 2026-09-02 audited code head `17ad5306a220327bcea9844429b72f228462094e`, including repository delta, Railway deployment/runtime state, ARK control-plane/config/shop/restart safety, Nexus Forge, Palworld provider-neutral server connectivity, and the retired Once Human server-control scope.

## Repository delta
Pre-audit branch head: `638ac722ac45974f1af4188f617071a7f8b3f776` (`test: cover ARK source-of-truth parity validation`).

Compared with the previous audited code head, the branch is **23 commits ahead, 0 behind**. The delta is concentrated in:
- Git-backed ARK canonical `GameUserSettings.ini`, `Game.ini`, and `rates.json` source-of-truth data.
- ARK restart fail-closed policy, scheduler integration, tests, and operational notes.
- MAP2/Astraeos ArkShop shared prebind and safer Gen1-independent catalog preservation.
- ARK RCON diagnostics.
- SFTP configuration/baseline application refactor.
- Public Nexus Guide Hub and supporting tests.

The active branch remains unprotected (`protected=false`; required status checks are not enforced).

## Deployment state
### Green / still running
- Postgres: SUCCESS.
- KNX-BUILD-NODE-01/02/03: SUCCESS.
- `nexus-ark-dynamic-config`: SUCCESS.
- Khaos Nexus Forge: SUCCESS; no new Forge deployment in this audit window.
- Last successful Sentinel deployment: commit `56e5d10237ff8ecb05ef51eb1a1c6dae40ea5141` (`Sentinal: resolve ARK baseline from canonical INIs`). That runtime remains online and logged in to Discord.

### P0 deployment regression
The newest Sentinel deployment for commit `5d1992ba69bafe85197b0c7225c1a7f4b6be8dc1` (`Sentinal: enforce ARK rates registry parity`) **FAILED** during `npm run check && npm test`. The branch-head parity test deployment is subsequently SKIPPED, so production is still on the older successful Sentinel image.

The failure is a false-positive representation mismatch in `src/sentinel/ark-sftp-config.cjs`: canonical INI values such as `1.0` and `5.0` are strings, while JSON parses `1.0` and `5.0` as numeric `1` and `5`; `comparableValue()` converts the number back to `"1"`/`"5"`, so semantically equal values fail strict string equality. The import-time `CANONICAL_BASELINE = loadCanonicalBaseline()` then throws before unrelated test modules can load. Result: 57 test failures in the failed build.

### Required fix
1. Preserve fail-closed parity, but compare numeric-looking INI and registry values semantically as finite numbers, with exact normalized comparison reserved for booleans/strings.
2. Add tests for `1` vs `1.0`, `5` vs `5.0`, fractional values, booleans, missing keys, and genuinely different numbers.
3. Do not make canonical-data validation a module-import side effect. Run it in an explicit ARK config preflight/startup gate so a config mismatch blocks ARK config mutation/deployment without crashing unrelated Sentinel modules/tests.
4. Prefer one editable authority. Given the current implementation, keep the canonical INIs as the full source and generate/validate `rates.json` as derived structured metadata rather than maintaining two independently editable authorities.

## P0 — ARK authoritative state is still split-brain
The last successful runtime still reports two incompatible views:
- Core ARK metadata: `maps=1 ... errors=1 diskInventories=0 installedMods=0`.
- Unified staff ARK operations: `servers=2 mods=38 modUpdates=38`.

Startup explicitly records `ARK_MAP2:existing=map2:enabled=false`, even though cluster management reports `maps=2`, MAP2 SFTP discovery succeeds, live Astraeos logs are found, and the map is actively saving world state.

Required: one `ArkClusterReadiness` authority consumed by metadata, staff UI, restart safety, dynamic config, ArkShop/shared economy, mod updates, and Forge. Expected map IDs/count must be a hard invariant. Any disagreement must produce a degraded/fail-closed state rather than a green surface.

## P0 — MAP2 RCON is not operational from Sentinel
Startup RCON diagnostics show:
- Gen1 RCON healthy on `72.46.128.202:30081`.
- Sentinel is configured to probe MAP2 on `72.46.128.202:30121` and receives a TCP timeout.
- MAP2 `GameUserSettings.ini` reports `RCONEnabled=true` and `RCONPort=30081`.

The INI/internal port and externally reachable provider port may legitimately differ under NAT, so do not blindly overwrite either value. Resolve the actual provider-exposed public RCON endpoint and make Sentinel's MAP2 connection profile match it. Until then, MAP2 save/restart/admin operations that require RCON must remain unavailable/fail-closed.

## P0 — ArkShop/shared economy remains blocked, but MAP2 improved
Material progress:
- MAP2 SFTP discovery now resolves canonical `GameUserSettings.ini`, `Game.ini`, and ArkShop `config.json` paths.
- MAP2 shared ArkShop prebind completes without importing local SQLite player rows or touching gameplay INIs; it preserves Astraeos' existing catalog and reports a stable DB fingerprint.

Remaining blocker:
- Gen1 SFTP discovery still cannot find canonical GUS/Game.ini/ArkShop `config.json` in the permitted tree; one maintenance cycle also timed out during connection handshake.
- Gen1 ArkShop SQLite snapshot path is still stale/unavailable.
- ArkShop maintenance remains `maps=1 ready=0 attention=1`.
- Shared economy guard remains fail-closed with cluster starter/bank/cache operations disabled.

Required: repair Gen1 exact SFTP root/path configuration and confirm a two-map read-only preflight against one shared MySQL authority before enabling cluster economy mutations.

## P1 — restart safety improved, but the desired Sentinel schedule is disabled
The restart-safety implementation is materially stronger and now has fail-closed policy/tests. However the running deployment logs `ARK restart scheduler-disabled` with `serverEnabled=true` and `scheduleEnabled=false` for Gen1.

Do not enable automatic cluster restarts until MAP2 registry truth and MAP2 RCON are fixed. Then restore the intended 06:00 schedule with the configured warning/countdown path and make the scheduler require all expected maps to pass readiness before executing a cluster restart.

## P1 — EventEmitter/clientReady architecture remains unfixed
The current successful startup still emits:
`MaxListenersExceededWarning: 51 clientReady listeners added`.

Continue the planned centralized extension/boot registry. Do not suppress this by only raising max listeners. Modules should register lifecycle hooks once with dependency ordering, per-extension health, and isolated optional-module failure handling.

## P1 — ARK permission/rank sync is blocked
Startup reports all six managed ASA permission groups missing/unconfirmed:
`NexusShadowRecruit`, `NexusCipherRunner`, `NexusRaider`, `NexusKhaosWarden`, `NexusBlackoutLegend`, `NexusOriginFounder`.

The rank sync correctly refuses to continue without confirmed group creation. Add an explicit permissions-plugin capability/preflight and a safe create-then-readback workflow. Do not grant rank entitlements until the plugin confirms the groups exist.

## P1 — SFTP discovery/refactor regression surface
`ark-sftp-config.cjs` was substantially rewritten in this delta, while production continues to fail Gen1 canonical discovery. Keep discovery bounded to the permitted server tree, but expose explicit configured root/path, discovered alternatives, last successful path, and freshness in staff diagnostics. Config writes must never fall back to a guessed path.

## P1 — branch/release protection still absent
`rebuild/nexus-0.1` remains unprotected while it drives production deployment. Require at least the test/build gate and prevent force-pushes. Add a post-deploy smoke gate that checks Sentinel process health plus ARK authoritative readiness before promotion can be considered complete.

## P2 — source-of-truth design cleanup
The new Git-backed canonical ARK baseline is the right direction, but the current duplicate representation (`INI` + independently-authored structured rates registry) already caused a release failure. Generate derived metadata from the canonical files, attach a content hash/version to published dynamic-config artifacts, and expose that version in `/ark-health` so Sentinel can prove what each map is actually running.

## P2 — useful feature opportunities
- Unified `ArkClusterReadiness` object with expected/discovered maps, RCON, SFTP, dynamic config, shop provider/backend, shared DB fingerprint, WBUI2, mod inventory freshness/confidence, restart state, and last-good timestamps.
- ARK config deployment receipt: source commit, artifact hash, target map, backup path, apply/verify result, rollback reference.
- Per-map external/internal RCON endpoint model to avoid false mismatch alarms on NAT/proxied hosts.
- Staff panel action to run read-only shop/database convergence preflight without mutating player data.

## Palworld / Nitrado review
No file in the 23-commit delta changes Palworld/Nitrado architecture. Keep the existing provider-neutral model:
1. Safely/private-routed official REST when supported.
2. RCON fallback where supported.
3. Manual/status-only mode when neither is available.

Nitrado-specific service IDs/tokens/provider adapters remain retired. Current CI still exercises the Palworld provider's official REST administration/snapshot surface. Future useful work is an explicit per-server capability classification (`rest|rcon|manual`) and health state, independent of hosting provider.

## Once Human deep-setup review
No overnight change reintroduces game-specific Once Human server management. Keep durable ownership/config/admin automation retired because rental Custom Server IDs are reused and are not safe ownership identifiers. Preserve only generic primitives learned from the deep setup work: profiles, presets, permission gates, audit logs, restart-required state, and community/news surfaces.

Add a capability-registry guard marking Once Human as `community-only`/`server-control-disabled` so generic hosted-server UI cannot accidentally offer ownership binding or config writes for it later.

## Revised build gate
1. Fix rates-parity validator and restore a green Sentinel deployment.
2. Restore MAP2 in the authoritative cluster registry and eliminate split-brain ARK readiness.
3. Resolve MAP2's actual external RCON endpoint.
4. Repair Gen1 SFTP/ArkShop canonical paths and prove shared MySQL economy convergence across both maps.
5. Complete two-map dynamic-config preview → validate → publish → fetch → apply → verify → rollback acceptance with hashes/receipts.
6. Repair ASA permission group provisioning/rank sync.
7. Replace accumulated `clientReady`/login lifecycle hooks with a centralized extension registry.
8. Add branch/release protection and post-deploy ARK smoke gates.
9. Then continue deeper Nexus Forge/Sentinel integration.

## Owner input
No product/architecture decision is required.

Owner/host action is needed only if Sentinel cannot programmatically determine the provider-exposed MAP2 RCON endpoint or if Gen1's actual Citadel SFTP root/path differs from the paths Sentinel is permitted to discover. Everything else can proceed as implementation/configuration work without changing the agreed architecture.

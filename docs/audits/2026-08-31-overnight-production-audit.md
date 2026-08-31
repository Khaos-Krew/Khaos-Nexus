# Khaos Nexus Overnight Production Audit — 2026-08-31

## Scope
Baseline: `42c3d91727ac98f6b4bc882295210be01198d035` (2026-08-30 audit documentation)
Audited branch head before this audit write: `d234b77fe68ffa3f5874844795301ae01b71de24` (`feat(ark): add Shiny anomaly lifecycle foundation (#487)`)
Branch: `rebuild/nexus-0.1`
Delta: 29 commits ahead, 0 behind.

## Deployment state
- Railway project `discerning-purpose` production is readable again.
- `nexus-sentinal-0-1-test`: SUCCESS, latest deployment created 2026-08-31T11:58:29Z.
- Postgres: SUCCESS.
- KNX-BUILD-NODE-01/02/03: SUCCESS.
- Sentinel Railway `/health` succeeded on first probe.
- Sentinel logged into Discord successfully and ARK Gen1 RCON startup probe succeeded.
- Separate Railway project `Khaos Nexus Forge`: SUCCESS; repeated `/health` requests return 200.

## Completed / materially advanced
1. ARK dynamic-config runtime is loading (`ARK dynamic config profiles ready: profiles=1`).
2. ARK cluster management runtime is loading (`maps=2`, refresh every 60 seconds).
3. Gen1 RCON is healthy and player polling works.
4. ARK startup readiness/log discovery is active and detected 37 mods.
5. ArkShop profile management is active and Gen1 SQLite is readable.
6. Forge bridge health reports `ok=true`, version `0.5.0`, OpenAI/GitHub enabled, fallback disabled, draft-PR-only policy.
7. All three controlled build workers are deployed successfully.
8. ARK permission/rank sync runtime is installed and six managed groups are present.
9. WShop migration tooling/config was added, including a generated migration manifest and cutover documentation.
10. Dino-cache persistence and Shiny anomaly lifecycle foundations were added, with tests and MySQL schema files.

## P0 findings

### P0.1 — Astraeos shop/database cutover is not ready
Live Sentinel log:
- `Astraeos ArkShop SQLite-to-MySQL migration blocked: Source-defined ArkShop config path does not exist on Astraeos.`
- Later SFTP discovery reports the Astraeos `Game.ini` missing from the permitted tree and rejects a non-canonical ArkShop `config.json` path.

Impact:
- MAP2 shop migration cannot be trusted or completed.
- Any cluster-wide economy operation must remain blocked until the exact live MAP2 paths and backend are verified.

Required fix:
- Correct MAP2 SFTP path configuration to the canonical live Game.ini and ArkShop/WShop config path.
- Re-run read-only discovery first.
- Only after source validation, perform migration/cutover with backup + checksum + rollback artifact.

### P0.2 — Cluster economy is correctly fail-closed because databases are not yet shared
Live guard:
`ok=false mode=non-shared-database ... cluster-wide starter/bank/cache operations must remain disabled until all maps share one verified MySQL backend.`

This is correct safety behavior and must not be bypassed.

Required fix:
- Finish moving Gen1 and MAP2 to the single Citadel MySQL backend.
- Verify both maps write/read the same canonical account/points data.
- Then enable starter/bank/cache cluster operations and perform cross-map idempotency tests.

### P0.3 — Astraeos WBUI2 is not using Nexus production JSON
Astraeos log shows:
- `JsonURL=` empty.
- WBUI2 falls back to `https://raw.githubusercontent.com/DC-Modding/WBUI2-Wiki/main/default.json`.

Impact:
- MAP2 is not receiving the Nexus-managed WBUI2 panel even though the repository has a production JSON artifact.

Required fix:
- Correct MAP2 `JsonURL` in GameUserSettings.ini/required WBUI2 section.
- Point it to the Nexus raw-hosted JSON.
- Trigger `cheat scriptcommand WBUI2 update` after validation.
- Add a Sentinel readiness check that marks a map degraded when WBUI2 is using the upstream default URL instead of the Nexus URL.

## P1 findings

### P1.1 — ASA API / ArkShop UI dependency state is incomplete on MAP2
Startup readiness currently reports:
- `asaApiUtils955333=false`
- `arkShopUi942249=false`

This may be transitional during the ArkShop/WShop work, but Sentinel should not report the shop stack as launch-ready while required dependencies for the selected provider are absent.

Recommended fix:
- Make shop-provider compatibility explicit per map: ArkShop, WShop, or disabled.
- Gate readiness on only the dependencies required by the selected provider.
- Avoid mixed ArkShop/WShop startup paths on the same map unless running a deliberate migration mode.

### P1.2 — Forge probe signal is internally inconsistent
Early startup reports:
`Forge authenticated bridge probe: ok=true ... state=failure checks=3 tokens=0`
Later health reports:
`Forge bridge health: ok=true version=0.5.0 openai=true github=true fallback=disabled policy=draft-pr-only`

Recommended fix:
- Normalize probe semantics so `ok=true` cannot be paired with an unexplained `state=failure` without a classified reason.
- Surface CI failure separately from bridge/auth health.

### P1.3 — NatureShop export is leaking large encoded payloads into runtime logs
The one-time export writes twelve large base64 chunks containing the entire shop configuration to Railway deploy logs.

Risk:
- excessive log volume/noise;
- configuration disclosure through logs;
- harder incident review.

Recommended fix:
- Write exports to an artifact/file or protected object store, not stdout.
- Log only hash, byte size, item counts, and artifact location.
- Clear the one-shot flag after verified artifact persistence.

### P1.4 — Experimental Node SQLite warning remains
Runtime emits Node's experimental SQLite warning. It is not currently fatal.

Recommended fix:
- Keep SQLite access read-only/migration-only where possible and continue MySQL convergence.
- Suppress only the known warning if operational logs become noisy; do not hide real SQLite errors.

## P2 opportunities / cleanup
1. Add a single ARK map readiness object with config-path, RCON, SFTP, shop-provider, DB-sharing, WBUI2, mod-dependency, and restart-scheduler states.
2. Expose that readiness via `/ark-health` and staff status panel with red/yellow/green gates.
3. Add a provider-neutral shop adapter (`arkshop`, `wshop`, `none`) so Sentinel logic is not hard-coded around one plugin.
4. Add migration idempotency keys/checksums to shop/account/cache migrations.
5. Add a post-deploy smoke gate that fails release when a configured map falls back to stock WBUI2 or cannot resolve its canonical shop config path.
6. Reduce startup log payloads; move large diagnostics to artifacts and emit compact summaries.

## Palworld / Nitrado architecture status
- Nitrado-specific integration remains retired by architecture decision.
- Palworld remains provider-neutral: REST preferred when safely/private-routed, RCON as fallback where supported, manual/status-only mode when neither is available.
- Do not reintroduce Nitrado service IDs, provider tokens, or provider-specific ownership into Sentinel.

## Once Human architecture status
- Deep Once Human server-management integration remains retired.
- Reused rental Custom Server IDs are not safe durable ownership identifiers.
- Preserve only game-neutral configuration/profile abstractions that can be reused safely elsewhere.
- News/community feeds may remain independent of server ownership/control integration.

## Build order / release gate
1. Complete shared MySQL economy convergence for Gen1 + Astraeos.
2. Fix Astraeos canonical config/SFTP discovery and shop-provider readiness.
3. Fix Astraeos WBUI2 Nexus JsonURL and verify in game.
4. Validate remaining ASA API/plugin or WShop dependencies per selected provider.
5. Exercise Sentinel-owned dynamic configs end-to-end: preview -> validate -> apply -> verify -> rollback.
6. Then continue Nexus Forge feature expansion/integration.

## Owner input needed
No new product decision is required. Existing architecture decisions are sufficient.
Operational action may be needed only if the exact Astraeos live config paths cannot be discovered automatically; Sentinel should attempt read-only discovery first and report the precise unresolved path rather than requesting secrets.

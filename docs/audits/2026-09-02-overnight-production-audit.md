# Khaos Nexus Overnight Production Audit — 2026-09-02

## Audit scope

Baseline code head: `d7edd6f4c4eb795af9ca2cc24cd0f8549a5f6103` (2026-09-01 audit).
Audited pre-document head: `17ad5306a220327bcea9844429b72f228462094e`.
Branch: `rebuild/nexus-0.1`.
Delta: **21 commits ahead, 0 behind**.

Changed files in the compare window are concentrated in ARK operations: Shiny Astraeos test config, dynamic-config proxy, CurseForge mod intelligence, MAP2 rate repair, four ARK staff/status/update panel extensions, Sentinel entry wiring, plus the prior audit document.

## Executive finding

Railway infrastructure is healthy, but the ARK control plane is not yet safe to treat as cluster-ready. The most important issue is now **split-brain operational truth**: core cluster metadata and ArkShop guards see one enabled map and zero disk inventories, while the new unified staff operations panel independently sees two servers and 38 mods. Until these sources converge, staff UI must not be allowed to imply cluster readiness or drive automated restart/update decisions.

## P0 — ARK cluster registry remains one-map and the cause is explicit

Production startup reports:

- `ARK_MAP2:existing=map2:enabled=false`
- recurring `ARK cluster metadata ... maps=1 changed=0 errors=1 diskInventories=0 installedMods=0`

At the same time, MAP2 identity/log discovery succeeds and identifies `Astraeos_WP` / `Khaos Nexus (Astraeos)`. MAP2 is therefore reachable through the SFTP/log diagnostic path but excluded from the active cluster registry.

### Required fix

1. Repair the MAP2 registry bootstrap/persistence so the expected second map is enabled when its connection profile is valid.
2. Make expected map IDs/count a hard readiness invariant.
3. Add a restart/redeploy regression test that fails if configured Gen1 + MAP2 collapse to one active map.
4. Do not permit cluster-wide economy/config/restart actions to report green while an expected map is disabled or absent.

## P0 — ARK inventory/update truth is inconsistent

Core metadata remains at `diskInventories=0 installedMods=0`, but the newly deployed unified ARK staff operations panel repeatedly reports `servers=2 mods=38 modUpdates=38`.

The unified panel builds its own state by reading API logs, probing SFTP, and then comparing discovered mod folder file IDs against CurseForge. That path is useful, but it is currently independent from the authoritative cluster-metadata inventory state.

The `38/38` update result is suspicious enough that it must be treated as **unverified**, not as a restart/update trigger, until a sample of installed file IDs is manually or programmatically cross-checked against known current CurseForge files.

### Required fix

Create one authoritative `ArkClusterReadiness` / inventory service and have both automation and staff panels consume it. It should distinguish `healthy`, `stale`, `not_scanned`, `unavailable`, and true `empty`, include per-map source/freshness timestamps, and preserve installed file IDs used for update comparison. The staff panel should display a degraded/verification state whenever authoritative inventory and panel-local discovery disagree.

## P0 — ArkShop/shared economy remains fail-closed

Current runtime shows several independent ArkShop blockers:

- Gen1 SFTP discovery cannot locate canonical `GameUserSettings.ini`, `Game.ini`, or ArkShop `config.json` through the generic permitted-tree discovery path.
- ArkShop SQLite startup cannot obtain the configured snapshot path.
- ArkShop maintenance stays `maps=1 ready=0 attention=1` and repeatedly flags Gen1 unavailable.
- The shared economy guard is `ok=false mode=config-read-failed` and correctly keeps cluster-wide starter/bank/cache operations disabled.
- Astraeos SQLite→MySQL migration now reaches a database permission failure: `ER_DBACCESS_DENIED_ERROR`.

MAP2 exact-path discovery does find canonical `GameUserSettings.ini` and `Game.ini`, and its plugin directory visibly contains ArkShop, Permissions, CrosschatAscended and ExtendedRcon. Its ArkShop `config.json` exists in the ArkShop folder, but current canonical-path validation still rejects the configured path.

### Required fix

1. Normalize canonical SFTP path handling for both maps and eliminate duplicate/competing discovery rules.
2. Fix the Astraeos MySQL user/database grants or configured target database before retrying migration.
3. Add a read-only preflight that proves both maps resolve the exact ArkShop config/database paths and the same MySQL backend before any mutation.
4. Keep shared economy features disabled until cross-map point/account consistency is accepted.

## P1 — EventEmitter/listener architecture has crossed its warning threshold

Sentinel startup now logs:

`MaxListenersExceededWarning: Possible EventEmitter memory leak detected. 51 clientReady listeners added ... MaxListeners is 50.`

The new ARK extensions continue the existing pattern of wrapping `Client.prototype.login()` and attaching `client.once(Events.ClientReady, ...)`. This is now a concrete maintainability/runtime defect, not only a theoretical cleanup concern.

### Recommended fix

Replace extension-by-extension `Client.prototype.login` monkeypatching with a centralized Sentinel boot/extension registry. Register startup hooks in one place, apply dependency ordering, track per-extension health, and isolate optional extension failure. Do **not** solve this merely by increasing `setMaxListeners`; that would hide the architectural symptom.

## P1 — unified ARK panel is a useful feature, but needs safety semantics

The overnight change set added a consolidated staff-only ARK operations view, ASA/API release status, patch/release notes, CurseForge mod intelligence, status monitoring, and cluster update panels. This is a meaningful operational improvement.

Before it becomes a trusted control surface:

- label data source and freshness per section;
- fail degraded when server counts differ between sources;
- do not call every file-ID mismatch an actionable update without compatibility/file-channel validation;
- add last-good inventory and last-successful SFTP timestamps;
- separate `update available`, `version unknown`, and `inventory unavailable` states.

## P1 — active deployment branch is still unprotected

`rebuild/nexus-0.1` reports `protected=false`; required status-check enforcement is off. Current head does have successful Railway status checks for Sentinel, dynamic-config, and KNX-BUILD-NODE-03, but those checks are not enforced by the branch.

### Recommended fix

Add release/branch rules that prevent force-pushes and require the agreed test/deployment checks for production promotion while preserving the current development workflow.

## Deployment state — verified 2026-09-02

Railway production state:

- Sentinel `nexus-sentinal-0-1-test`: **SUCCESS**, deployment `d416a794...`.
- `nexus-ark-dynamic-config`: **SUCCESS**, deployment `db8c234a...`.
- Postgres: **SUCCESS**.
- KNX-BUILD-NODE-01/02/03: **SUCCESS**.
- Khaos Nexus Forge: **SUCCESS**, deployment `552f5089...`.

Forge is responding with HTTP 200 on `/health` and `/api/v1/ci`. Sentinel's Forge bridge reports `ok=true`, version `0.5.0`, OpenAI/GitHub enabled, fallback disabled, and `draft-pr-only` policy. This is a healthy foundation, but ARK readiness gates should remain ahead of deeper Forge-to-Sentinel automation.

The dynamic-config service is deployed successfully. No external HTTP traffic appeared in the sampled service log window; this does not by itself prove per-map apply/verify/rollback acceptance. The owner-defined gate remains incomplete until both configured maps pass the full preview → validate → publish → fetch → apply → verify → rollback cycle.

## Completed / materially advanced since 2026-09-01

- 21-commit forward-only branch delta.
- Unified staff ARK operations panel implemented and live.
- Dedicated CurseForge API mod-intelligence module added.
- ASA/API status and update panels expanded.
- MAP2 rate-repair helper added.
- Astraeos Shiny test configuration added.
- Dynamic-config proxy allowlist expanded.
- Forge remains healthy and its Sentinel bridge reports draft-PR-only operation.
- MAP2 live logs confirm Astraeos is running and saving world state even though the active cluster registry currently disables it.
- ARK startup diagnostic detects 38 loaded mods and confirms ASA API Utils `955333` and ArkShop UI `942249` are present in the observed MAP2 startup data.

## Palworld / Nitrado architecture review

No files in this 21-commit audit delta touch Palworld or Nitrado integration. The accepted architecture remains unchanged:

- no Nitrado-specific provider adapter, service-ID ownership, or token path;
- Palworld uses provider-neutral game/server interfaces;
- prefer safely/private-routed Palworld REST where available;
- use RCON as compatibility/fallback where supported;
- otherwise expose manual/status-only capability.

Useful future work remains a capability probe that classifies each Palworld connection profile as `rest`, `rcon`, or `manual`, without coupling Sentinel to a hosting provider.

## Once Human deep-setup review

No files in this audit delta reintroduce Once Human server-management code. The accepted retirement decision remains correct: rental Custom Server IDs are reused and are not safe durable ownership keys.

Keep Once Human-specific ownership/config/admin automation retired. Preserve only generic reusable primitives from the earlier deep setup work: configuration profiles, presets, permission-gated panels, audit logging, restart-required state, and community/news surfaces where useful.

## Cleanup / feature opportunities

1. **Single authoritative ARK readiness model** consumed by staff panels, update automation, economy guards, restart safety and dynamic config.
2. **Centralized extension boot registry** to remove 51+ `clientReady` listener accumulation and repeated login monkeypatching.
3. **Canonical SFTP path registry** per map, with validated exact paths and last-good timestamps rather than repeated broad discovery.
4. **Mod-update confidence model** that distinguishes exact-current, update-available, ambiguous channel/platform match, stale inventory, and unavailable inventory.
5. **Staff panel provenance** showing source + freshness for server status, mod inventory, API compatibility, shop backend and dynamic config.
6. **Post-deploy ARK smoke gate** asserting expected maps, RCON, SFTP canonical paths, mod inventory freshness, shop backend state and dynamic-config fetch before declaring the control plane ready.

## Current build gate

1. Re-enable/restore MAP2 in the authoritative cluster registry.
2. Reconcile inventory truth so automation and staff UI agree on the same 2-map/38-mod source of record.
3. Repair canonical ArkShop SFTP paths and Astraeos MySQL access; complete shared-economy convergence.
4. Complete MAP2-inclusive dynamic-config preview/validate/publish/fetch/apply/verify/rollback acceptance.
5. Fix the EventEmitter extension-registration architecture.
6. Add production branch/release and post-deploy smoke gates.
7. Then continue deeper Nexus Forge/Sentinel integration.

## Owner input needed

No product or architecture decision is needed today.

Host/owner action is only required if the current credentials cannot be granted the intended Astraeos MySQL database access, or if Citadel's exact live ArkShop path differs from the path Sentinel can derive from the visible SFTP tree. Otherwise the defects are implementation/configuration work inside Nexus/Sentinel.

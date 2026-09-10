# Sentinel v2 ARK migration inventory

This inventory records the migration disposition of the ARK stack currently loaded by `src/sentinel/entry.cjs`. It is intentionally conservative: production behavior remains untouched until the v2 shadow/read-only paths are proven.

## Migration rules

- **adapter** — reusable ARK capability behind the v2 module boundary; no self-owned background timer.
- **job** — recurring or long-running work owned by the central Sentinel scheduler.
- **one-time migration** — explicit idempotent job with completion/audit state; never permanent startup behavior.
- **control-plane interaction** — Discord command/panel surface that requests worker actions rather than performing long work itself.
- **retire/review** — diagnostic/bootstrap/deployment behavior that should not stay resident without a demonstrated runtime requirement.

## Current ARK stack disposition

| Current component | v2 disposition | Notes |
| --- | --- | --- |
| `ark-ops-extension.cjs` | control-plane interaction | Keep operator surface; route mutations through ActionController/worker. |
| `ark-update-safety-extension.cjs` | job + adapter | External/update checks belong to scheduler; any mutation remains approval/audit gated. |
| `ark-rcon-diagnostic-extension.cjs` | adapter/control-plane | Diagnostics are on-demand reads; RCON mutation client becomes worker adapter. |
| `ark-staff-unified-ops-panel-extension.cjs` | control-plane interaction | UI only; no direct long-running RCON/SFTP work. |
| `ark-config-drift-alert-extension.cjs` | job | Scheduled read/compare; incident state handles repeat failures/drift. |
| `ark-identity-health-extension.cjs` | job | Health observation belongs to central scheduler. |
| `arkshop-profile-health-extension.cjs` | job | Health observation; no startup mutation. |
| `arkshop-apply-health-extension.cjs` | job | Health observation; remediation must be a separate gated action. |
| `ark-nexus-bank-health-extension.cjs` | job | Read-only health path first. |
| `ark-restart-scheduler-extension.cjs` | job | Replace module-owned schedule with central scheduler definition. |
| `ark-server-controls-extension.cjs` | control-plane + worker action | Commands request audited/idempotent worker actions. |
| `ark-dynamic-events-extension.cjs` | job | Central scheduler owns recurring event evaluation. |
| `ark-config-db-extension.cjs` | adapter | Persistence/config repository boundary. |
| `ark-cluster-extension.cjs` | adapter | Server registry/domain model. |
| `ark-additional-registry-bootstrap-extension.cjs` | one-time migration | Bootstrap must have durable completion state. |
| `ark-cluster-metadata-extension.cjs` | adapter/job | Metadata reads are adapter calls; refresh cadence belongs to scheduler. |
| `ark-config-profile-extension.cjs` | adapter | Configuration profile domain service. |
| `arkshop-profile-extension.cjs` | adapter | Shop profile domain service. |
| `arkshop-maintenance-monitor.cjs` | job | Central scheduler + incidents. |
| `ark-cluster-public-actions.cjs` | control-plane + read adapter | Discord interactions should consume read snapshots; no self-owned refresh timer in v2. |
| `arkshop-profile-bootstrap-extension.cjs` | one-time migration | Explicit idempotent migration only. |
| `ark-cluster-plan-extension.cjs` | control-plane/adapter | Planning is safe/read-first; mutations gated separately. |
| `arkshop-nexus-economy-v1-runtime.cjs` | one-time migration/review | Versioned launch runtime should not execute forever at startup. |
| `arkshop-nexus-launch-v2-runtime.cjs` | one-time migration | Convert to explicit migration record. |
| `arkshop-nexus-launch-v3-kits-runtime.cjs` | one-time migration | Convert to explicit migration record. |
| `arkshop-nexus-launch-v4-resources-runtime.cjs` | one-time migration | Convert to explicit migration record. |
| `arkshop-nexus-launch-v5-disable-legacy-sell-runtime.cjs` | one-time migration | Historical launch mutation; remove from permanent startup after verified completion. |
| `arkshop-nexus-launch-v6-remove-demo-items-runtime.cjs` | one-time migration | Historical launch mutation. |
| `arkshop-nexus-launch-v7-basic-sell-runtime.cjs` | one-time migration | Historical launch mutation. |
| `arkshop-nexus-launch-v8-boss-sell-runtime.cjs` | one-time migration | Historical launch mutation. |
| `arkshop-nexus-launch-v9-apex-tribute-sell-runtime.cjs` | one-time migration | Historical launch mutation. |
| `arkshop-nexus-launch-v10-native-item-delivery-runtime.cjs` | one-time migration/adapter extraction | Extract reusable delivery capability; migration remains explicit. |
| `arkshop-nexus-launch-v11-apothecary-runtime.cjs` | one-time migration | Historical launch mutation. |
| `arkshop-nexus-launch-v12-love-craft-fix-runtime.cjs` | one-time migration | Historical fix; no permanent startup execution. |
| `arkshop-map2-clone-from-gen1-runtime.cjs` | one-time migration | Explicit clone operation with completion/idempotency record. |
| `natureshop-gen1-export-runtime.cjs` | retire/review | Export utility should be on-demand, not resident startup behavior. |
| `arkshop-nexus-launch-v13-potion-balance-runtime.cjs` | one-time migration | Historical balance migration. |
| `arkshop-nexus-launch-v14-shadow-recruit-potion-prices-runtime.cjs` | one-time migration | Historical pricing migration. |
| `arkshop-nexus-launch-v15-rank-timed-points-runtime.cjs` | one-time migration/adapter extraction | Extract reusable timed-points job if still required; launch setup remains migration. |
| `dinodepot-category-probe-runtime.cjs` | retire/review | Diagnostic probe should be explicit/on-demand. |
| `arkshop-ui-live-deploy-runtime.cjs` | retire/review or gated job | Deployment behavior must never happen implicitly at bot startup. |
| `arkshop-cluster-economy-guard.cjs` | job/policy | Keep guard logic, but execute through scheduler/policy engine. |
| `arkshop-backend-preflight-runtime.cjs` | job | Read-only readiness/preflight check. |
| `ark-dino-cache-sqlite-probe.cjs` | retire/review | Probe becomes on-demand diagnostic. |
| `ark-shiny-config-runtime.cjs` | adapter/job after inspection | Separate read/config capability from any recurring mutation. |
| `ark-dino-cache-runtime.cjs` | adapter/job after inspection | Cache reads can be adapter; refresh work belongs to scheduler. |
| `ark-command-routing-patch.cjs` | retire/rewrite | Replace monkey-patch routing with v2 command registry. |
| `ark-dynamic-config-http.cjs` | control-plane API/adapter | Move behind explicit v2 API and ActionController authorization. |
| `protocol/discord.cjs` | control-plane protocol | Keep protocol boundary but remove ARK worker concerns from gateway process. |

## First migrated read path

Sentinel v2 now includes `src/sentinel-v2/ark-health-adapter.cjs`. It wraps the existing proven `loadLiveArkPublicInfo()` reader without importing the legacy Discord interaction/timer runtime. The adapter:

- performs reads only;
- normalizes per-map health;
- isolates one map failure from other maps;
- exposes a scheduler registration helper (`ark.health.read`);
- defines timeout/retry/jitter centrally;
- performs no registry write, RCON mutation, Discord write, restart, config write, or ArkShop mutation.

The next ARK migration should use this adapter to emit durable health/audit/incident state, then remove the equivalent refresh loop only during a controlled cutover after shadow comparison.

# Khaos Nexus Overnight Production Audit — 2026-08-30

Baseline: `a0518bbf352b053edc5433efe98e912ddfd505d0`
Current rebuild head: `1dff50101f7b4623b1b898248c6dce6fe7c9d656`
Delta: 62 commits ahead, 0 behind.

## Executive status

The rebuild branch made a large ARK-focused jump overnight and introduced the first production build-worker/Forge execution infrastructure. GitHub combined commit status for the current head reports success for both `nexus-sentinal-0-1-test` and `KNX-BUILD-NODE-03`. Direct Railway log/deployment inspection is currently blocked by connector viewer-role access, so runtime health/log cleanliness is not independently certified by this audit.

## P0 — Required before Forge continuation

1. Complete ArkShop/API live acceptance and prove shop purchase/sell/native item delivery paths against the real server.
2. Complete dynamic config ownership in Sentinel before continuing Forge feature work. Sentinel must validate, version, publish/apply, audit, and roll back config changes, and distinguish live-reloadable settings from restart-required settings.
3. Verify current Sentinel deployment SHA and startup/runtime logs once Railway viewer access is restored.
4. Treat the new build-worker cluster as infrastructure-under-validation until all three nodes, queue leasing, heartbeat/lease expiry, release gates, and health checks are demonstrated live.

## Completed / materially advanced

- Added ARK account linking, identity store, cross-chat/spawn monitoring, event/reward services, supporter cache services, and update monitor/safety logic.
- Added extensive ArkShop launch/runtime stages through v12, including basic sells, boss sells, Apex/tribute sells, native item delivery, Apothecary, Love Potion crafting fix, and Gen1-to-MAP2 catalog clone gating.
- Added ArkShop UI live deploy/diagnostic paths and launch-readiness checks.
- Added fail-closed ARK mod-update safety behavior and supporting tests.
- Added build-worker runtime, schema/store/executor/server/release-gate code plus Dockerfile and tests.
- Documented three preferred worker lanes: Forge, ARK, and general/overflow, backed by one PostgreSQL queue.
- Current branch head wires the Love Potion fix and MAP2 shop clone runtimes into Sentinel startup.

## Defects / regression risks

### P0
- Railway visibility gap: direct deployment/log inspection fails because the connected account lacks viewer permission. GitHub deployment statuses are green, but this is weaker than direct runtime/log verification.
- Large startup surface: `src/sentinel/entry.cjs` now installs many ArkShop/runtime extensions. A failure in any startup module can become a broad Sentinel boot regression. Add startup-isolation tests and structured per-extension boot logging.
- MAP2 clone and shop mutation paths can create cross-map economy/config drift if they are not idempotent. Require dry-run/diff, source/target checksums, transaction/rollback behavior, and post-clone verification before enabling automatic use.

### P1
- Build-worker release controls are well designed on paper, but deploy webhooks/health URLs are intentionally unset during rollout. This is correct for safety, but means the deployment path is not yet end-to-end proven.
- Worker authentication is a shared bearer-token model. Rotateable per-node credentials or scoped worker identities would reduce blast radius later.
- ARK event/reward/update subsystems added substantial persistent state and timers. Verify dedupe across restart/redeploy and shared-cluster behavior to prevent duplicate rewards, announcements, or event execution.
- ArkShop native item delivery and sell flows need duplicate-delivery / duplicate-credit protections around retries and reconnects.

### P2
- Add a single Sentinel boot manifest/registry for extensions instead of a long chain of direct `require(...).install...()` calls. This will improve ordering, health reporting, optional-module gating, and rollback.
- Add build-worker cluster telemetry to Sentinel: node heartbeat, active lease, queue depth, failed jobs, release stage, and blocked deployment reason.

## Architecture cleanup / retired integrations

Nitrado-specific provider integration remains retired. Palworld support should stay provider-neutral using REST where safely reachable and RCON only as fallback; no new Nitrado service-ID/token coupling should be introduced.

Once Human server integration remains retired. Reused rental server IDs are not a safe durable ownership identifier. Do not resume Once Human-specific automation, ownership binding, or deep configuration control. Generic profile/config infrastructure created during that exploration may be reused for supported games.

Any open roadmap text or issue that still frames Nitrado-specific or Once Human integration as active should be relabeled historical/retired or closed after confirming no reusable generic work is lost.

## Active build order

1. ArkShop/API live acceptance.
2. Remaining ASA API/plugin validation.
3. Sentinel-owned dynamic configs with validation/history/rollback/apply semantics.
4. Build-worker cluster live validation.
5. Resume Nexus Forge development.
6. Integrate Forge into Sentinel through the controlled worker/release APIs.
7. Add Discord/admin-facing Forge status and permission-gated actions only after release safety is proven.

## Owner input needed

No product-design decision is required this morning. Operationally, restore at least Railway viewer access for the connected integration so deployment SHA, runtime logs, health, and worker-node status can be verified directly.

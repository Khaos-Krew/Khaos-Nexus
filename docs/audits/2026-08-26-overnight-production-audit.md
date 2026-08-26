# Khaos Nexus / Sentinel Overnight Production Audit — 2026-08-26

Status: active audit; audit-only, no production fixes implemented in this document.

## Current production evidence
- Fresh Railway evidence: project `discerning-purpose`, production service `nexus-sentinal-0-1-test`, deployment `654f88c5-2009-4d5d-996c-8e83c54aa901`: SUCCESS, built from `rebuild/nexus-0.1` commit `125891958c9c1f118b37571278bc850417bbfaa2`; `/health` succeeded on first attempt.
- GitHub `rebuild/nexus-0.1` head is `125891958c9c1f118b37571278bc850417bbfaa2` (`docs: refresh overnight audit live evidence`), matching the live Railway deployment at the start of this audit pass.
- Discord reconciliation remains structurally stable: 18 Sentinel-ready modules + 1 Veyra-delegated D&D module; no module access attention/pending; 18 managed hub panels; private safety access reports no failures; category/channel reconciliation shows no outstanding moves or missing structural items.
- Hosted-server reconciliation still reports `tracked=0 groups=0` repeatedly through the latest logs, so Palworld/Once Human registration and provider acceptance remain unproven in production.
- Creator Program still reports `twitch=pending youtube=pending`.
- Periodic auto-provision remains relatively expensive: no-change cycles are commonly ~10–18 seconds, with category-order work sometimes adding ~7 seconds.

## Findings

### OA-001 — Hosted-server feature deployed but registry remains empty
- Severity: High (functional/integration)
- Evidence: repeated live `game servers registry ... tracked=0 groups=0` on the current successful deployment; owner has Palworld and Once Human servers to register.
- Affected: Hosted Server Manager, backend persistence, #game-servers.
- Root-cause hypothesis: feature code exists but no production server records have been registered yet and/or persistence/config wiring has not been acceptance-tested against Railway storage.
- Recommended fix: acceptance-test `/server add`, persistence across restart/redeploy, private/public projections, and panel reconciliation with one Palworld + one Once Human record before calling the feature complete.
- Acceptance: two records survive restart/redeploy; public panel groups both games; private host/ports/credential-env never appear publicly; duplicate add rejected; edit/remove refresh correctly.
- Owner approval: No for tests/fixes; owner input required only for actual server connection values/credentials.

### OA-002 — Palworld provider model needs Nitrado-specific RCON/REST live acceptance
- Severity: High (incomplete integration)
- Evidence: branch history records Nitrado-backed Palworld status checks and a Nitrado service-ID/token-environment setup flow, but current live registry remains empty and no real provider cycle is demonstrated. Owner confirmed Palworld host is Nitrado and requires RCON or REST setup.
- Affected: Palworld provider adapter, server manager, credentials, admin actions.
- Root-cause hypothesis: provider abstraction was created before the hosting provider was known; implementation has advanced to read/status setup but destructive/game-level management has not been proven against the real service.
- Recommended fix: retain explicit `nitrado` provider mode. Prefer supported Nitrado REST for service lifecycle/status/backups/settings where API authorization permits; use Palworld dedicated-server REST/RCON only for game-level functions that Nitrado exposes/reaches safely. Keep credentials as environment references; separate read-only telemetry from destructive controls; require explicit confirmation for restart/stop/restore.
- Acceptance: real Nitrado service authenticates using environment-held token; auth failure fails closed; token/service ID/host/admin secrets redacted; status maps to Online/Offline/Maintenance; restart has confirmation + audit record; unsupported actions are disabled rather than guessed; timeout/backoff/circuit-breaker tests; owner validates one real status cycle.
- Owner approval: Yes before enabling destructive remote controls and for real provider credentials; No for read-only telemetry implementation/tests.

### OA-003 — Once Human requires a configuration-management model, not an assumed public API
- Severity: High (architecture/incomplete integration)
- Evidence: current official Once Human Custom Server material documents extensive dashboard configuration and host privileges but no verified public server-management API. July 9, 2026 added split scenario selection/gameplay-mode selection, in-match templates, weather, camera-perspective/free-camera controls and Crimson Revelry settings; June 10 added weapon/armor durability-loss controls; May 13 added custom weapon/armor/item definitions with a settings-capacity limit; April 23 added announcements, up-to-three scenario templates, host facilities, Hive capacity controls, vehicle/facility restrictions and RaidZone Hyper Brawl tooling. Current branch correctly treats setup as official-dashboard/manual.
- Affected: Once Human hosted-server integration.
- Root-cause hypothesis: early server-manager design treated provider integrations too uniformly; NetEase exposes rich owner configuration without a verified public automation contract, and its schema is evolving monthly.
- Recommended fix: keep Once Human as `netease-managed` with manual/snapshot configuration tracking first. Do not scrape/reverse-engineer private endpoints. Version the schema by game update and scenario; model server identity, rental expiry/frozen/deletion risk, invitation/public mode, scenario, gameplay mode, player cap, admins, templates, custom-content capacity and configuration snapshots/diffs. Add guided setup/checklist and exportable config profile inside Sentinel; automation only if NetEase publishes a supported interface.
- Acceptance: no private endpoint dependency; schema is scenario-aware/versioned; unavailable settings disappear for incompatible scenarios (for example farming/maps in RaidZone where documented); dangerous scenario switch/reset has explicit progression warning; expiry alerts cover frozen/deletion risk; invite visibility is owner-controlled; owner can complete setup without exposing secrets publicly.
- Owner approval: Yes for desired gameplay configuration/profile; No for safe schema/tooling.

### OA-004 — Warframe world-state provider intermittently returns HTTP 404 across all feed slices
- Severity: Medium (reliability)
- Evidence: prior live logs showed 404 PROVIDER_ERROR for news/events/alerts/sortie/arbitration/nightwave/void-trader/steel-path before later recovery.
- Affected: Warframe feed provider/reconciler.
- Root-cause hypothesis: transient upstream/base-path/platform routing issue or endpoint/version mismatch with fallback/cache masking outage later.
- Recommended fix: instrument provider URL/platform/version without secrets, classify 404 separately from transport errors, validate current upstream contract, add exponential backoff + stale-cache serving and aggregate common upstream failures.
- Acceptance: provider contract test; simulated 404 uses last-good cache and marks freshness; one aggregated error per provider incident; automatic recovery verified.
- Owner approval: No.

### OA-005 — Periodic reconciliation is heavier/noisier than necessary
- Severity: Medium (reliability/performance/operability)
- Evidence: current live logs show module auto-provision about every five minutes, typically ~10–18 seconds with zero changes; many panels reconcile every minute; creator-role channel-update runs repeat frequently; inventory is 260 channels/165 roles.
- Affected: Sentinel reconciliation scheduler, Discord rate-limit budget, logs.
- Root-cause hypothesis: independent periodic loops and broad inventory scans rather than shared snapshots/event-driven invalidation.
- Recommended fix: central reconciliation scheduler, shared guild inventory snapshot, jitter/backoff, dirty flags, coalescing of channel update/delete events, slower cadence for stable panels, structured metrics instead of repetitive info logs.
- Acceptance: no behavior regression; API call count and reconciliation wall time materially reduced; Discord rate-limit test; event burst coalescing test.
- Owner approval: No.

### OA-006 — Creator Program integrations remain pending
- Severity: Medium (incomplete feature)
- Evidence: current live logs repeatedly report `twitch=pending youtube=pending` while creator category/roles/command are present.
- Affected: Content Creator Program / Now Live role.
- Root-cause hypothesis: Discord-side workflow landed before external account/webhook/API integration.
- Recommended fix: complete OAuth/account-link and live-state adapters with provider rate-limit handling; make pending state explicit in staff status rather than implying full program completion.
- Acceptance: Twitch + YouTube test accounts; live/offline transition; duplicate notification suppression; role removal on offline; revoked-token behavior.
- Owner approval: likely Yes for account/app credentials and notification policy.

### OA-007 — Module access still has an explicit human acceptance gap
- Severity: Medium (acceptance)
- Evidence: current live `module access preflight` reports `humanTestRequired=true` despite attention=0/pending=0.
- Affected: module access roles/buttons/channel visibility.
- Root-cause hypothesis: automated permission graph checks cannot prove end-user Discord visibility/interactions.
- Recommended fix: execute acceptance matrix with normal member, staff, and D&D/Veyra delegation; record results and only then clear acceptance flag.
- Acceptance: add/remove role buttons, color-role precedence, game category visibility, staff bypass, Veyra D&D visibility.
- Owner approval: No unless owner wants to personally perform UX acceptance.

### OA-008 — Build test step is Docker-cache reused
- Severity: Medium (CI confidence)
- Evidence: current Railway build again shows `[9/9] RUN npm run check && npm test` as cached even though deployment healthcheck is fresh.
- Affected: deployment assurance.
- Root-cause hypothesis: Docker layer cache correctly reuses identical test inputs, but visible per-deploy evidence cannot detect environment-sensitive regressions.
- Recommended fix: keep deterministic cached unit tests if desired, but add a non-cacheable lightweight deployment acceptance/smoke stage against the built artifact and live health/command-registration surfaces.
- Acceptance: each deployment records fresh smoke result; failure blocks promotion or flags deployment.
- Owner approval: No.

### OA-009 — Railway audit visibility recovered; remove permission repair from active fix queue
- Severity: Resolved / informational
- Evidence: current audit can list projects/services/deployments and read build/deploy logs for the production service. Earlier viewer-access failure was transient/connection-specific.
- Affected: production auditing.
- Root-cause hypothesis: transient connector identity/session mismatch rather than durable project permission loss.
- Recommended fix: no production change. Continue verifying Railway readability each audit pass and reopen only if access failure recurs.
- Acceptance: current pass can read latest deployment and logs without write access.
- Owner approval: No.

### OA-010 — Desktop dependency patch drift exists but is not an immediate Sentinel production blocker
- Severity: Low (maintenance/security hygiene)
- Evidence: `discord.js` is pinned to current 14.27.0. `electron-builder` is pinned 26.15.3 while a newer v26 patch (26.15.7) exists; Electron is pinned 43.2.0 while 43.4.1 is current. Desktop development is paused and Sentinel's Railway image uses Node 22, so this drift is primarily deferred desktop maintenance.
- Affected: paused Windows desktop build/toolchain.
- Root-cause hypothesis: intentional stabilization/pause plus exact-version pinning.
- Recommended fix: do not churn desktop dependencies during the pause. Before desktop work resumes, review Electron/electron-builder release notes/security advisories, update one dependency family at a time, rebuild installer, and rerun desktop smoke/update tests.
- Acceptance: clean install/update path, launch smoke, updater rollback, no Electron security warnings/regressions.
- Owner approval: No for patch maintenance once desktop work resumes.

## Once Human configuration inventory to model
Official/current categories identified for the configuration schema: basic server profile (name/public access/player capacity/slogan/intro); scenario selection + scenario gameplay mode + up-to-three scenario templates; world resources; farming/husbandry with scenario-dependent visibility; Deviants and Deviations; maps/teleport behavior with scenario-dependent visibility; combat/PvP/damage/HP/ammo; Deviant combat stats; character survival/progression/death penalties; survival/building; tech/crafting/social/management; territory auto-packing; overlap/floating/restricted-area building; free/cost-free/instant crafting/building; vehicles; facility restrictions; host facilities; Hive capacity; announcements; server-host privileges/item distribution; admins/player management; leaderboards; in-server shop; custom weapon/armor/item definitions with Settings Value capacity; weather; player camera perspective; host free camera; RaidZone Hyper Brawl/restricted-zone/shop controls; Crimson Revelry timing and Lord-of-Moonlight stats; Special Drops event timing/Honor Point parameters; durability loss; in-match templates for leaderboards/shop/host-privilege modes.

## Priority order for fixes after audit approval
1. Hosted-server production acceptance/persistence (OA-001).
2. Nitrado Palworld provider live acceptance, read-only first (OA-002).
3. Once Human NetEase-managed configuration schema + guided setup/live owner acceptance (OA-003).
4. Warframe provider resilience (OA-004).
5. Reconciliation scheduler/API-budget optimization (OA-005).
6. Fresh deployment smoke gate (OA-008).
7. Human module-access acceptance (OA-007).
8. Creator external integrations (OA-006).
9. Deferred desktop dependency patch review when desktop work resumes (OA-010).

## Audit pass notes
### 02:10 CT pass
- No critical active production/security issue was established; no early user notification warranted.
- Exact GitHub head and CI were green.
- Nitrado and Once Human setup work was present but both still required real owner/provider acceptance.
- Railway live recheck was temporarily blocked and recorded as OA-009.

### 03:08 CT pass
- No critical active production/security issue established; no early user notification warranted.
- Railway visibility recovered. Current deployment is SUCCESS, exact GitHub/Railway commit alignment is confirmed, and `/health` passed first attempt.
- Discord reconciliation remains structurally stable, but hosted-server registry is still empty (`tracked=0 groups=0`), keeping OA-001/OA-002 high priority.
- Once Human official configuration research was refreshed through July 2026 changes; schema must be versioned/scenario-aware because the configuration surface is actively expanding.
- Dependency review found no stale `discord.js`; desktop-only Electron/electron-builder patch drift is low priority while desktop work remains paused.

### 04:11 CT pass
- No critical active production/security issue established; no early user notification warranted.
- Railway deployment `654f88c5-2009-4d5d-996c-8e83c54aa901` is SUCCESS on GitHub head `125891958c9c1f118b37571278bc850417bbfaa2`; `/health` passed first attempt.
- Live Discord reconciliation remains stable with zero module attention/pending and no private-safety failures.
- Hosted-server registry remains empty through the newest log window (`tracked=0 groups=0`), so real Palworld/Nitrado and Once Human acceptance is still the highest functional gap.
- Auto-provision no-change passes still consume roughly 10–18 seconds, reinforcing OA-005; no rate-limit or active failure evidence was observed in this pass.
- Railway's unit/check layer was cache-reused again, reinforcing OA-008; fresh runtime health is green but a non-cacheable deployment smoke gate is still recommended.

## Next audit runs
- Recheck live deployment/log deltas and whether hosted-server `tracked` changes from zero.
- Inspect exact Nitrado adapter/provider implementation and focused tests for timeout/backoff, status mapping, action confirmation and secret redaction.
- Inspect hosted-server command UX/privacy projections and persistence storage/volume configuration.
- Inspect Warframe provider contract/fallback implementation against the observed 404 incident.
- Inspect reconciliation timers/event listeners for duplicated work and Discord API-budget risk.
- Append/refine findings here; do not duplicate existing IDs.

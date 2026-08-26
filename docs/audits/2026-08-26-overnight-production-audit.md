# Khaos Nexus / Sentinel Overnight Production Audit — 2026-08-26

Status: active audit; audit-only, no production fixes implemented in this document.

## Current production evidence
- Last verified Railway evidence: project `discerning-purpose`, production service `nexus-sentinal-0-1-test`, deployment `aa89e121-42fa-421a-967c-3f5c3ae1a460`: SUCCESS; build healthcheck `/health` succeeded. The Railway connector could not re-read the project on the 02:10 CT audit pass because the connected identity lacked viewer access, so this run does not claim fresher live Railway state.
- GitHub `rebuild/nexus-0.1` head is `e509f45485681293fa2b2f51ab88befaa8794437` (`docs: start consolidated overnight production audit`). Nexus Rebuild CI run #674 completed successfully against that exact head at 2026-08-26 06:12:47Z.
- The immediately preceding validated implementation/documentation head `cb340a91…` records Nitrado-backed Palworld status checks plus `/server setup` guidance and a privacy-safe Once Human official-dashboard configuration catalog; live owner/provider acceptance remains explicitly outstanding.
- Last verified Discord reconciliation evidence was broadly stable: 18 Sentinel-ready modules + 1 Veyra-delegated D&D module; no module access attention/pending; 18 managed hub panels; private safety access reported no failures.
- Last verified hosted-server reconciliation still reported `tracked=0 groups=0`, so the new Palworld/Once Human server manager has not yet demonstrated live registered server data in production.

## Findings

### OA-001 — Hosted-server feature deployed but registry remains empty
- Severity: High (functional/integration)
- Evidence: repeated live `game servers registry ... tracked=0 groups=0` after hosted-server work; owner currently has Palworld and Once Human servers to register.
- Affected: Hosted Server Manager, backend persistence, #game-servers.
- Root-cause hypothesis: feature code exists but no production server records have been registered yet and/or persistence/config wiring has not been acceptance-tested against Railway storage.
- Recommended fix: acceptance-test `/server add`, persistence across restart/redeploy, private/public projections, and panel reconciliation with one Palworld + one Once Human record before calling the feature complete.
- Acceptance: two records survive restart/redeploy; public panel groups both games; private host/ports/credential-env never appear publicly; duplicate add rejected; edit/remove refresh correctly.
- Owner approval: No for tests/fixes; owner input required only for actual server connection values/credentials.

### OA-002 — Palworld provider model needs Nitrado-specific RCON/REST architecture and live acceptance
- Severity: High (incomplete integration)
- Evidence: current branch documentation now records Nitrado-backed Palworld status checks and a Nitrado service-ID/token-environment setup flow, but live provider acceptance is still explicitly outstanding. Owner confirmed Palworld host is Nitrado and requires RCON or REST setup.
- Affected: Palworld provider adapter, server manager, credentials, admin actions.
- Root-cause hypothesis: provider abstraction was created before the hosting provider was known; implementation has advanced to read/status setup but destructive/game-level management has not been proven against the real service.
- Recommended fix: retain explicit `nitrado` provider mode. Prefer supported Nitrado REST for service lifecycle/status/backups/settings where API authorization permits; use Palworld dedicated-server REST/RCON only for game-level functions that Nitrado exposes/reaches safely. Keep credentials as environment references; separate read-only telemetry from destructive controls; require explicit confirmation for restart/stop/restore.
- Acceptance: real Nitrado service authenticates using environment-held token; auth failure fails closed; token/service ID/host/admin secrets redacted; status maps to Online/Offline/Maintenance; restart has confirmation + audit record; unsupported actions are disabled rather than guessed; timeout/backoff/circuit-breaker tests; owner validates one real status cycle.
- Owner approval: Yes before enabling destructive remote controls and for real provider credentials; No for read-only telemetry implementation/tests.

### OA-003 — Once Human requires a configuration-management model, not an assumed public API
- Severity: High (architecture/incomplete integration)
- Evidence: official Once Human material documents official rentals, dedicated management panel/GM privileges, invitation codes/public unlock, parameter editing, player/admin management, scenario switching/reset semantics, but no verified public management API was found. Current branch documentation correctly treats setup as official-dashboard/manual and records a structured configuration catalog.
- Affected: Once Human hosted-server integration.
- Root-cause hypothesis: early server-manager design treated provider integrations too uniformly; NetEase exposes rich owner configuration without a verified public automation contract.
- Recommended fix: keep Once Human as `netease-managed` with manual/snapshot configuration tracking first. Do not scrape/reverse-engineer private endpoints. Model server identity, rental expiry/frozen/deletion risk, invitation/public mode, scenario, player cap, admins, and versioned configuration profiles/templates. Add guided setup/checklist and config diff/export inside Sentinel; automation can be added only if NetEase publishes a supported interface.
- Acceptance: no private endpoint dependency; settings schema is scenario-aware/versioned; dangerous scenario switch/reset warns that player progression is reset; expiry alerts cover frozen state and >30-day deletion risk; invite code visibility is owner-controlled; owner can complete setup from the guide without exposing secrets publicly.
- Owner approval: Yes for desired gameplay configuration/profile; No for safe schema/tooling.

### OA-004 — Warframe world-state provider intermittently returns HTTP 404 across all feed slices
- Severity: Medium (reliability)
- Evidence: prior live logs at ~04:59 and ~05:09 UTC showed 404 PROVIDER_ERROR for news/events/alerts/sortie/arbitration/nightwave/void-trader/steel-path; by ~05:29 UTC feeds recovered and reused/updated Discord messages.
- Affected: Warframe feed provider/reconciler.
- Root-cause hypothesis: transient upstream/base-path/platform routing issue or endpoint/version mismatch with fallback/cache masking outage later.
- Recommended fix: instrument provider URL/platform/version (without secrets), classify 404 separately from transport errors, validate current upstream contract, add exponential backoff + stale-cache serving and avoid eight error-level log lines per cycle for one common upstream failure.
- Acceptance: provider contract test; simulated 404 uses last-good cache and marks freshness; one aggregated error per provider incident; automatic recovery verified.
- Owner approval: No.

### OA-005 — Periodic reconciliation is heavier/noisier than necessary
- Severity: Medium (reliability/performance/operability)
- Evidence: prior live evidence showed module auto-provision roughly every five minutes taking ~10–20 seconds even with zero changes; many panels reconcile every minute; repeated creator-role channel-update runs; 260 channels/165 roles scanned.
- Affected: Sentinel reconciliation scheduler, Discord rate-limit budget, logs.
- Root-cause hypothesis: independent periodic loops and broad inventory scans rather than shared snapshots/event-driven invalidation.
- Recommended fix: central reconciliation scheduler, shared guild inventory snapshot, jitter/backoff, dirty flags, coalescing of channel update/delete events, slower cadence for stable panels, structured metrics instead of repetitive info logs.
- Acceptance: no behavior regression; API call count and reconciliation wall time materially reduced; Discord rate-limit test; event burst coalescing test.
- Owner approval: No.

### OA-006 — Creator Program integrations remain pending
- Severity: Medium (incomplete feature)
- Evidence: prior live logs repeatedly reported `twitch=pending youtube=pending` while creator category/roles/command were present.
- Affected: Content Creator Program / Now Live role.
- Root-cause hypothesis: Discord-side workflow landed before external account/webhook/API integration.
- Recommended fix: complete OAuth/account-link and live-state adapters with provider rate-limit handling; make pending state explicit in staff status rather than implying full program completion.
- Acceptance: Twitch + YouTube test accounts; live/offline transition; duplicate notification suppression; role removal on offline; revoked-token behavior.
- Owner approval: likely Yes for account/app credentials and notification policy.

### OA-007 — Module access still has an explicit human acceptance gap
- Severity: Medium (acceptance)
- Evidence: prior live `module access preflight` reported `humanTestRequired=true` despite attention=0/pending=0.
- Affected: module access roles/buttons/channel visibility.
- Root-cause hypothesis: automated permission graph checks cannot prove end-user Discord visibility/interactions.
- Recommended fix: execute acceptance matrix with normal member, staff, and D&D/Veyra delegation; record results and only then clear acceptance flag.
- Acceptance: add/remove role buttons, color-role precedence, game category visibility, staff bypass, Veyra D&D visibility.
- Owner approval: No unless owner wants to personally perform UX acceptance.

### OA-008 — Build test step was Docker-cache reused
- Severity: Medium (CI confidence)
- Evidence: prior Railway build showed `[9/9] RUN npm run check && npm test` as cached. GitHub exact-head CI #674 is independently green, which improves source validation but does not replace a fresh live deployment smoke.
- Affected: deployment assurance.
- Root-cause hypothesis: Docker layer cache allows an unchanged test layer to be reused; valid for identical inputs, but it weakens visible per-deploy evidence and can hide environment-sensitive test behavior.
- Recommended fix: keep deterministic cached unit tests if desired, but add a non-cacheable lightweight deployment acceptance/smoke stage against the built artifact and live health/command-registration surfaces.
- Acceptance: each deployment records fresh smoke result; failure blocks promotion or flags deployment.
- Owner approval: No.

### OA-009 — Live Railway observability is not consistently available to the audit identity
- Severity: Medium (operability/audit confidence)
- Evidence: this audit pass could access GitHub and exact-head CI but Railway `get-status` returned that the connected identity lacks the required viewer role for the known project ID.
- Affected: production auditing, incident verification, deployment/log acceptance.
- Root-cause hypothesis: connector account/project permission drift or a different Railway connection than the one used for the earlier successful live audit.
- Recommended fix: restore read-only/viewer access for the connected Railway identity used by audits; do not grant deployment/write authority merely to solve observability.
- Acceptance: audit can read project status, latest deployment, build/deploy/http logs, service configuration metadata, and health evidence without gaining destructive permissions.
- Owner approval: Yes, because Railway account/project access is an owner-controlled external permission.

## Once Human configuration inventory to model
Official/current categories identified for the configuration schema: basic server profile (name/public access/player capacity/slogan/intro); scenario selection + scenario gameplay mode + scenario templates; world parameters; Deviations; maps/teleport behavior; combat/PvP/damage/HP/ammo; character survival/progression/death penalties; survival/building; tech/crafting/social/management; territory auto-packing; overlap/floating/restricted-area building; free/cost-free/instant crafting/building; vehicles; facility restrictions; host facilities; Hive capacity; announcements; server-host privileges/item distribution; admins/player management; leaderboards; in-server shop; custom weapon/armor/item definitions with Settings Value capacity; weather; camera perspective/free camera; scenario-specific RaidZone/Crimson Revelry/Special Drops/card-room parameters; durability loss; up-to-three scenario templates plus in-match templates.

## Priority order for fixes after audit approval
1. Hosted-server production acceptance/persistence (OA-001).
2. Nitrado Palworld provider live acceptance, read-only first (OA-002).
3. Once Human NetEase-managed configuration schema + guided setup/live owner acceptance (OA-003).
4. Restore read-only Railway audit visibility (OA-009).
5. Warframe provider resilience (OA-004).
6. Reconciliation scheduler/API-budget optimization (OA-005).
7. Fresh deployment smoke gate (OA-008).
8. Human module-access acceptance (OA-007).
9. Creator external integrations (OA-006).

## Audit pass notes
### 02:10 CT pass
- No critical active production/security issue was established; no early user notification warranted.
- Exact GitHub head and CI are green.
- Nitrado and Once Human setup work is present in branch documentation/validated head, but both still require real owner/provider acceptance before being called complete.
- Railway live recheck is blocked by read-only permission, recorded as OA-009 rather than silently assuming stale evidence is current.

## Next audit runs
- Recheck Railway deployment/log deltas if viewer access becomes available; specifically verify whether `tracked` changes from zero.
- Inspect exact hosted-server/Nitrado implementation paths and focused tests from commit history/tree rather than default-branch code search; verify no partial provider code is live without command/schema support.
- Deepen Once Human schema against current official configuration pages and flag scenario-dependent fields.
- Inspect dependency/package versions and security posture without changing them.
- Inspect command/UX readability and privacy projections for hosted-server records.
- Append/refine findings here; do not duplicate existing IDs.

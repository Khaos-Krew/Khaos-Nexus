# Khaos Nexus / Sentinel Overnight Production Audit — 2026-08-26

Status: 07:00 CT findings finalized. This audit updates tracking/documentation; no destructive production action was taken.

## Executive status
- Branch `rebuild/nexus-0.1` is 20 commits ahead of the hosted-server baseline inspected overnight. The delta includes the hosted-server status service, Nitrado Palworld setup/status work, Once Human configuration model, Discord manager/panel changes, focused tests, and this audit.
- The last verified production evidence before 05:08 CT was healthy, but the 07:00 Railway recheck is currently blocked by connector authorization (`viewer` role unavailable). Treat current deployment state as **not freshly re-verified at 07:00**, not as failed.
- The last live logs available in this audit showed the hosted-server registry still empty (`tracked=0 groups=0`). Therefore the code exists, but real Palworld + Once Human production acceptance is still incomplete.
- Discord structural reconciliation remained stable in the last verified production logs: zero module-access attention/pending, no private-safety failures, 18 managed hub panels converged.

## Priority findings

### P0 — OA-001 Hosted-server production acceptance/persistence
**State:** implementation present; real production acceptance incomplete.

The server manager, persistent store, status service and public panel wiring exist, but the last live registry remained empty. Before this is called complete, register one Palworld and one Once Human server and prove persistence across a restart/redeploy, duplicate prevention, edit/remove, private/public projections, and grouped `#game-servers` rendering.

**Acceptance:** both records survive restart/redeploy; public panel groups both games; private host/ports/provider refs/credential env never leak; duplicate add rejected; edit/remove refresh correctly.

### P0 — OA-002 Palworld / Nitrado: REST first, RCON/game REST only where justified
**State:** Nitrado-specific provider path and setup/status scaffolding present; real account/service acceptance still needed.

Recommended architecture:
1. Nitrado REST is the provider/control-plane source for service lifecycle/status and provider-supported operations.
2. Direct Palworld dedicated-server REST or RCON is a separate game-plane adapter only when the Nitrado server exposes/reaches it safely.
3. Read-only status is enabled/accepted before destructive controls.
4. Restart/stop/restore require explicit confirmation and audit logging.
5. Token remains in Railway environment storage; Discord stores only the credential environment-variable name. Nitrado service ID/provider reference stays private.

**Still required:** real Nitrado service ID + API-token environment variable, one live status cycle, timeout/backoff/circuit-breaker tests, unsupported-action gating, and owner approval before destructive controls.

### P0 — OA-003 Once Human / NetEase configuration manager
**State:** safe manual-dashboard model exists, but schema needs expansion to match the current August 2026 configuration surface.

The current implementation correctly refuses to depend on undocumented NetEase endpoints and exposes a guided official-dashboard setup model. Fresh official research confirms the Custom Server surface is broader than the current coarse sections and is actively changing.

**Confirmed current capabilities to model:**
- Basic server identity/access, player capacity, scenario selection and separate gameplay-mode selection.
- Scenario-aware settings and saved/in-match templates for leaderboard, in-server shop and host-privilege modes.
- Weather controls, player camera-perspective policy and host Free Camera.
- Weapon/armor durability-loss settings.
- RaidZone controls including Hyper Brawl stage configuration and Special Drops timing/Honor Point rules.
- Crimson Revelry timing plus Lord of Moonlight HP, damage, movement, aggro and alert tuning.
- Host supply distribution including recipient targeting and reusable templates.
- Custom weapons/armor/items and settings-capacity constraints.
- Custom Server homepage metadata: cover image and gameplay tags.
- August 5 territory update: separate territory quantity limits (1–100) for host/admin/member, overall server territory cap 5,000, exclusive Custom Server building placement, and permission to allow members to place those buildings.

**Build direction:** version the schema (`2026-08`), make settings scenario-aware, store owner-entered snapshots/diffs rather than scraping the dashboard, add guided setup + exportable profile, lifecycle/expiry reminders, dangerous-change warnings, and private invite/admin handling. Automation should only be added if NetEase publishes a supported management interface.

### P1 — OA-004 Warframe provider resilience
Observed intermittent upstream 404s across world-state slices before recovery. Add provider-contract tests, stale-last-good serving, classified 404 handling, exponential backoff and incident aggregation.

### P1 — OA-005 Reconciliation/API-budget optimization
No-change auto-provision passes were still taking roughly 10–20 seconds, with category ordering alone occasionally near 10 seconds. Consolidate periodic loops around a shared guild inventory snapshot, dirty flags, event coalescing, jitter/backoff and slower cadence for stable panels.

### P1 — OA-008 Fresh deployment smoke gate
Railway's Docker test/check layer can be cache-reused. Keep deterministic cached tests, but add a non-cacheable post-build/live smoke check for `/health`, command registration and key reconciliation surfaces.

### P2 — OA-007 Human module-access acceptance
Automated permission checks are green but still report `humanTestRequired=true`. Execute normal-member/staff/Veyra-D&D visibility and role-button acceptance matrix before clearing the acceptance flag.

### P2 — OA-006 Creator integrations
Discord-side Creator Program structure exists, while Twitch and YouTube remain pending. Complete account linking/live-state adapters, duplicate-notification suppression, offline role removal and revoked-token handling when credentials/policy are ready.

### P3 — OA-010 Desktop dependency drift
Desktop work remains paused. Do not churn Electron/electron-builder now; review/update one family at a time when desktop development resumes.

## Completed / materially advanced overnight
- Hosted-server registry/provider architecture is no longer generic-only: explicit Nitrado Palworld and NetEase-managed Once Human paths are represented.
- Added hosted-server status service and focused Nitrado status tests.
- Added Once Human setup/config service and provider setup tests.
- Discord hosted-server manager and game-server panel were revised to consume the new provider/setup model.
- Privacy posture remains correct by design: credentials are environment references, and NetEase private endpoints are not scraped/reverse-engineered.
- Once Human research was refreshed through the August 5, 2026 Custom Server update, adding territory-role limits, 5,000 territory cap and exclusive-building controls to the required schema backlog.

## Blockers
1. **Real Nitrado acceptance data:** service ID and a Railway environment variable containing the Nitrado API token are required to prove live telemetry. Do not paste the token into Discord or project docs.
2. **Real hosted-server records:** the last verified live registry was empty, so Palworld/Once Human end-to-end panel behavior has not been proven with production records.
3. **Once Human automation:** no verified public NetEase management API was found. Safe implementation remains guided/manual official-dashboard configuration tracking.
4. **07:00 Railway verification:** Railway connector access currently reports insufficient viewer permission. Last verified production state was healthy; fresh 07:00 deployment/log verification is blocked until connector access is restored.

## Owner input needed
- **Palworld:** provide/configure the Nitrado service ID and create the Nitrado API-token environment variable in Railway; only the environment-variable name should be entered into Sentinel. Approve destructive remote controls separately after read-only telemetry is proven.
- **Once Human:** choose the desired server profile/scenario/gameplay style once access to the purchased server is available. Nexus can then turn that choice into a concrete recommended configuration profile using the versioned schema.
- No owner input is needed for Warframe resilience, reconciliation optimization, fresh smoke-gate work, or safe Once Human schema/tooling.

## Recommended execution order
1. Register both real servers and prove persistence/privacy/panel reconciliation.
2. Complete Nitrado read-only live acceptance; then add/approve destructive controls separately.
3. Expand Once Human schema to the August 2026 official surface and build guided profile/snapshot/diff tooling.
4. Fix Warframe resilience.
5. Reduce reconciliation/API churn.
6. Add fresh deployment smoke gate.
7. Complete human module-access acceptance.
8. Finish Twitch/YouTube Creator integrations when credentials are ready.

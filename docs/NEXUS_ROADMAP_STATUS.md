# Khaos Nexus — Canonical Roadmap Status

Status: **ACTIVE SOURCE OF TRUTH FOR README ROADMAP UPDATES**  
Owner: Production / stabilization process  
Consumers: Nexus Doc Watch, repository documentation maintainers, release/status reporting  
Repository: `Khaos-Krew/Khaos-Nexus`

## Purpose

This file is the canonical, machine-readable-enough roadmap/status handoff between production work and the **Nexus Doc Watch** documentation monitor.

The README roadmap must be updated from **repository reality plus this file**, not from chat memory, old release notes, abandoned branches, or rejected test builds.

The Doc Watch may update README roadmap/status content without owner approval when the change is a factual synchronization with GitHub reality.

## Current product line

- Main product line: **0.41.x**
- Current intended stabilization version: **v0.41.2-B**
- Known-good rollback target: **v0.41.1-B**
- Active stabilization branch: `stabilize/nexus-66-baseline`
- Active stabilization PR: **#266 — stabilization: establish Nexus 66% golden baseline**
- Temporary `Nexus Sentinel 0.33.0 RC1`: **REJECTED / HISTORICAL ONLY**

The 0.33.0 Sentinel RC1 line must never be presented as a successor to the main 0.41.x Khaos Nexus line.

## Current phase

**STABILIZATION RESET**

Feature expansion is frozen while the desktop application is brought to a dependable baseline.

The planned self-hosted web/backend migration remains deferred until the desktop stabilization target is accepted.

## Golden UI baseline

The approved modern desktop shell is required.

Required invariants:

- `nexus-v8` branding layer is present.
- Desktop shell/sidebar remains approximately **286px** wide at the supported baseline viewport.
- Navigation labels are fully readable and not clipped to only a few characters.
- Approved navigation ordering is preserved.
- Modern Khaos Nexus loading/startup presentation is preserved.
- Old loading screens, legacy sidebar layouts, stale navigation shells, and fallback renderer presentation are regressions.

## Functional stability gates

The stabilization score is measured against these 12 gates:

| # | Gate | Current roadmap state |
|---|---|---|
| 1 | Startup/loading | Automated startup checks and packaged startup/clean-install smoke pass; packaged visual/loading-presentation proof still required |
| 2 | Sidebar/navigation | Golden-shell source regression tests pass; packaged visual/navigation-invariant proof still required |
| 3 | Settings persistence | Stabilization required |
| 4 | Discord login/bot supervision | Stabilization required |
| 5 | Discord status/control panel | Stabilization required |
| 6 | Palworld server configuration | Stabilization required |
| 7 | Palworld status/player reads | Stabilization required |
| 8 | Palworld command/action execution | Stabilization required |
| 9 | Shared scheduler | Stabilization required |
| 10 | Module enable/disable | Stabilization required |
| 11 | Updater/manual release detection | Stabilization required |
| 12 | Backup/restore | Stabilization required |

Thresholds:

- **8/12** = minimum owner-test candidate
- **10/12** = beta quality
- **12/12** = release-candidate quality

The Doc Watch must not claim a numeric score unless repository evidence establishes which gates pass.

## Active roadmap

### Phase S0 — Stabilization governance

Status: **IN PROGRESS**

Goals:

- Freeze feature expansion.
- Maintain one active stabilization branch.
- Maintain one authoritative version identity.
- Prevent rejected/legacy product branches from becoming release ancestry.
- Convert owner-reported regressions into permanent automated guards.

### Phase S1 — Golden desktop shell

Status: **IN PROGRESS**

Current evidence:

- repository CI is green on the current PR #266 head;
- the golden-shell regression tests verify the `nexus-v8` branding layer, 286px sidebar invariant, and protection against heartbeat-driven navigation rebuilds;
- the packaged Windows executable reaches full startup readiness in both packaged-startup and clean-install smoke tests;
- the packaged startup smoke verifies readiness and visible-window exposure, but does not yet prove the exact packaged visual/sidebar/loading invariants required to exit S1.

Goals:

- Preserve the modern Khaos Nexus startup/loading presentation.
- Preserve the current sidebar width and navigation ordering.
- Guarantee full readable navigation labels.
- Add packaged-app UI/visual regression checks.
- Reject any candidate that falls back to a legacy shell.

Exit condition: startup/loading and sidebar/navigation gates are proven by automated packaged-app checks.

### Phase S2 — Core persistence and module stability

Status: **PLANNED / NEXT**

Goals:

- Verify settings persistence.
- Verify module enable/disable behavior.
- Verify shared scheduler authority and recovery.
- Verify backup/restore behavior.
- Remove obsolete compatibility paths that conflict with the current baseline.

### Phase S3 — Discord operational baseline

Status: **PLANNED**

Goals:

- Verify Discord login/auth flow.
- Verify supervised bot startup/recovery.
- Verify status/control panels.
- Verify critical Discord actions without duplicate authority paths.

### Phase S4 — Palworld operational baseline

Status: **PLANNED**

Goals:

- Verify Palworld configuration persistence.
- Verify REST/status/player reads.
- Verify guarded command/action execution.
- Verify server-control behavior without regressing the shared desktop shell.

### Phase S5 — Release and updater reliability

Status: **PLANNED**

Goals:

- Use one authoritative release identity.
- Keep package version, display version, updater version, tag, artifact names, notes, and rollback target synchronized.
- Ensure the artifact delivered to the owner is the same packaged build that passed CI.
- Verify manual release detection/download path.
- Repair and validate the in-app updater separately from manual-download readiness.

### Phase S6 — Owner acceptance

Status: **BLOCKED UNTIL >= 8/12**

Rules:

- Do not send normal owner-test builds below 8/12.
- Owner testing should focus on real-world behavior automation cannot prove.
- A major shell/loading/navigation regression automatically fails the candidate regardless of numeric score.

### Phase W1 — Self-hosted web migration

Status: **DEFERRED**

Direction:

- Khaos Nexus Web
- Khaos Nexus Backend/API
- lightweight Windows Nexus Agent for local-machine authority

This phase does not begin until the desktop baseline is accepted.

## Recently rejected direction

### Nexus Sentinel 0.33.0 RC1

Status: **FAILED OWNER ACCEPTANCE**

Reason:

- old loading presentation returned;
- sidebar behavior/order regressed;
- navigation labels were clipped;
- older renderer behavior reached the packaged artifact.

Useful Sentinel/Discord/Palworld implementation may be ported selectively, but its product shell and version line are not accepted baselines.

## README synchronization contract

The Nexus Doc Watch should keep a concise roadmap section in `README.md` synchronized with this file.

When updating the README:

1. Read this file.
2. Inspect the active stabilization PR and branch.
3. Inspect `config/release-identity.json` when present.
4. Inspect current GitHub Actions and actual published releases when release status is mentioned.
5. Update only facts supported by repository evidence.
6. Keep rejected/historical lines clearly labeled.
7. Do not claim a roadmap phase is complete merely because code exists on an unmerged branch.
8. Do not claim a build is published unless a real GitHub Release exists.
9. Do not change the roadmap direction based only on chat text when repository state disagrees.
10. If production materially changes phase/status, update this file first or in the same change set, then synchronize README.

## Recommended README roadmap format

The README should keep the roadmap compact. Use approximately this structure:

- **Now — Stabilization Reset:** golden shell + functional baseline.
- **Next — Core reliability:** persistence, modules, scheduler, backup/recovery.
- **Then — Discord + Palworld acceptance:** real operational flows.
- **Release hardening:** immutable tested artifact, version/updater consistency.
- **Later — Self-hosted web + Windows agent:** deferred until desktop stability is accepted.

Detailed gate status belongs in this file; the README should summarize rather than duplicate every implementation detail.

## Change discipline

Update this document whenever one of these materially changes:

- current development version;
- rollback target;
- stabilization branch/PR;
- active phase;
- functional gate status;
- owner acceptance result;
- release readiness;
- web migration status;
- a roadmap phase is completed, rejected, deferred, or replaced.

Routine commits that do not change roadmap meaning do not require an edit here.

# Khaos Nexus Core — Checkpoint Roadmap

Status: **Core v1 implementation complete; v0.41.0-B release validation pending**  
Execution branch: `arch/nexus-core-checkpoints`  
Baseline: `fix/v0.40.2-renderer-refresh`  
Authority contract: `docs/NEXUS_CORE_V1_AUTHORITY.md`

## Mission

Evolve Khaos Nexus from a collection of desktop modules into a supervised, local-first operating platform with one deterministic authority path for privileged execution, scheduling, audit, recovery, scoped AI context, and AI-assisted operations.

This was completed as an evolutionary consolidation rather than a rewrite. Existing proven patterns — the shared scheduler, AI Runtime host, isolated Veyra/Sentinel workers, module capability manifests, deterministic repair controls, D&D privacy boundaries, and renderer state hub — were promoted into reusable Nexus Core primitives.

## Non-negotiable architecture rules

1. **Nexus Core is authoritative for privileged external side effects.** UI, Discord, AI agents, and modules may request work; they do not bypass Core policy to perform game/server mutations covered by the v1 authority contract.
2. **AI proposes; deterministic services execute.** No model receives unrestricted RCON, shell, SQL/database, scheduler, Discord-token, or secret authority.
3. **One owner per singleton concern.** One shared scheduler, one renderer app-state fan-out path, one Core composition root per desktop data root, and one Core operational journal.
4. **Mutating operations are idempotent.** Durable/destructive Core commands have operation/idempotency identifiers and duplicate-execution protection.
5. **Events are append-only facts.** Current state can be projected from authoritative facts; checksummed snapshots accelerate recovery but do not replace history.
6. **Capabilities replace broad execution booleans.** Roles map to explicit capabilities and registered executors own their required capabilities.
7. **Workers fail independently.** Worker supervision uses bounded restart/circuit behavior and cannot expand worker authority.
8. **Context is scoped.** Workers receive only authorized user/server/module/campaign/session context; protected secrets are redacted before leaving Core boundaries.
9. **The renderer remains a control surface.** Business and infrastructure authority remain in main-process/Core services.
10. **Releases are evidence-gated.** The protected publisher validates the exact candidate before creating the tag/release.

---

## NX-CP00 — Stabilize the Foundation

**Status: COMPLETE**

Implemented one renderer app-state authority (`renderer/state-hub.js`), hub replay/readiness, updater/module-runtime migration, heartbeat-remount protection, and architecture enforcement tests.

**Gate:** Linux/Windows tests and the prior full Windows packaging/startup/clean-install pipeline have passed on the Core milestone.

---

## NX-CP01 — Nexus Core Contracts

**Status: COMPLETE**

Implemented immutable event/action/result envelopes with actor/source identity, correlation/causation, operation/idempotency identifiers, capability requirements, JSON-safe payload validation, and contract tests.

---

## NX-CP02 — Operational Event Journal + Projections

**Status: COMPLETE**

Implemented append-only NDJSON journal records, global/per-scope sequence validation, duplicate event handling, correlation replay, secret-field rejection, deterministic projections, and versioned SHA-256 checksummed snapshots with atomic writes.

---

## NX-CP03 — Capability Gateway

**Status: COMPLETE**

Implemented canonical capabilities, role mappings, runtime deny overrides, fail-closed unknown capability handling, Community Manager constraints, worker/context grants, and separate owner-only ban/direct-shutdown/force-stop/raw-console capabilities.

---

## NX-CP04 — Command / Execution Gateway

**Status: COMPLETE**

Implemented request → authorize → idempotency acquisition → deterministic execute → optional verify → journal result. Registered executors own required capabilities, so callers cannot weaken authorization.

Live Core-routed mutations now include:

- shared scheduler announce/save/shutdown stages;
- player kick/ban;
- hosted-server power operations;
- Palworld save/announce/moderation/shutdown/stop;
- Rust save/announce/moderation/shutdown/stop/raw command;
- Satisfactory backup/save/shutdown/stop/raw command;
- Operator Console Maintenance Mode.

Read-only status/players/metrics/settings queries remain outside the mutation gateway by design.

---

## NX-CP05 — Supervisor + Worker Runtime

**Status: COMPLETE FOR CORE V1**

Implemented reusable worker lifecycle/health projections, bounded exponential restart, circuit-open behavior, explicit stop/no-resurrection, and capability manifests that can only narrow authority. Existing isolated AI runtime supervision remains the execution host for Veyra/Sentinel and is covered by its established packaged-runtime tests.

---

## NX-CP06 — Durable Shared Scheduler

**Status: COMPLETE**

The existing shared scheduler remains the only durable game-maintenance scheduler. Destructive stages use stable run/stage/server/operation idempotency keys. Interrupted scheduler workflows are conservatively marked failed-for-review and are not automatically replayed.

---

## NX-CP07 — Context + Knowledge Isolation

**Status: COMPLETE**

Implemented Core context providers, per-worker allow/deny scope policy, limits, deep secret redaction, and metadata-only context grant/denial audit events.

- Nexus Sentinel: server/module/user scopes; campaign/D&D-session denied.
- Veyra: campaign/D&D-session/user scopes; server/module/hosted-server denied.

Existing Veyra D&D privacy/context generation remains the campaign-content source behind that domain boundary.

---

## NX-CP08 — AI Tool Gateway

**Status: COMPLETE AUTHORITY BOUNDARY**

Implemented typed/schema-validated read/propose/execute/approval-required tools, capability requirements, stable mutation idempotency, deterministic human approval verification, redacted results, and correlation into the Core journal.

Current Nexus Sentinel remains read/advisory with `directExecution: false`; adding the tool gateway does not grant destructive AI execution. Any future high-impact AI action must use this Core boundary.

---

## NX-CP09 — Thin Control Surface Migration

**Status: COMPLETE FOR CORE V1**

Implemented one renderer app-state hub, read-only Core health projection through existing public app state, a Settings Core status surface, and an explicit Stable/Test-Beta update-channel control. Privileged infrastructure execution remains in main-process/Core services.

The renderer may continue to use existing typed IPC names as transport; those IPC handlers/services no longer constitute alternate game-mutation authority where the v1 authority contract requires Core.

---

## NX-CP10 — Release Engineering + Recovery

**Status: IMPLEMENTED — FINAL v0.41.0-B GATE PENDING**

Implemented:

- checksummed projection snapshots;
- crash reconciliation of `running` Core operations to `uncertain` without replay;
- existing scheduler interrupted-workflow recovery;
- mandatory verified pre-update backups;
- stable default update channel plus opt-in Test/Beta channel;
- v0.41.0-B release metadata freeze;
- Windows tests/checks, package audit, packaged-startup smoke, clean-install smoke, artifact manifest, updater metadata, and signature-policy gates;
- bundled AI source/build/install/updater verification;
- a protected publisher that creates the immutable tag/release only after all release-candidate validation succeeds.

The remaining gate is execution of that exact protected v0.41.0-B publisher on the final candidate SHA.

---

## NX-CP11 — Nexus Core v1 Cutover

**Status: IMPLEMENTED — TEST RELEASE PENDING**

The v1 authority inventory and migration are complete for enabled privileged game/server mutation paths covered by `docs/NEXUS_CORE_V1_AUTHORITY.md`. Architecture tests enforce the singleton Core authority, state hub, AI isolation, and live game-mutation cutovers.

Compatibility paths may remain only for read-only queries, configuration/local UI work, diagnostics, or other surfaces that do not provide an alternate privileged execution route.

**Final cutover gate:** publish and install-test v0.41.0-B through the in-app updater; retain rollback/recovery evidence and correct any test-only regression before promoting later releases.

---

## v0.41.0-B test-update checkpoint

The release candidate is intentionally a normal latest GitHub release so legacy installed builds — which do not yet support the new opt-in Test/Beta selector — can discover this bridge update through their existing stable updater. Once v0.41.0-B is installed, future prerelease testing can use the opt-in Test/Beta channel while Stable remains the default.

No Railway service is required for this cutover. `just-warmth` remains reserved for future always-on ingress/relay/sync/scoped-worker workloads and does not become the desktop control plane.

## Handoff

Core v1 is code-complete on this branch and the non-publication CI gates are green. The implementation is review-ready. Public release publication remains a separate explicit Owner-authorized action.
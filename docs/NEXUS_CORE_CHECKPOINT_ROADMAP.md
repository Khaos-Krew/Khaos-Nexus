# Khaos Nexus Core — Checkpoint Roadmap

Status: **Active architecture roadmap**  
Execution branch: `arch/nexus-core-checkpoints`  
Baseline: `fix/v0.40.2-renderer-refresh`

## Mission

Evolve Khaos Nexus from a growing collection of desktop modules into a supervised, local-first operating platform with one deterministic authority path for state, permissions, scheduling, commands, audit, recovery, and AI-assisted operations.

This is an evolutionary consolidation, not a rewrite. Existing proven patterns — the shared scheduler, AI Runtime host, isolated Veyra/Sentinel workers, module capability manifests, deterministic repair controls, D&D idempotent state, and renderer state hub — are promoted into reusable Nexus Core primitives.

## Non-negotiable architecture rules

1. **Nexus Core is authoritative.** UI, Discord, AI agents, and modules may request work; they do not bypass Core policy to perform privileged work.
2. **AI proposes; deterministic services execute.** No model receives unrestricted RCON, shell, database, scheduler, Discord, or secret authority.
3. **One owner per singleton concern.** One scheduler, one Discord connection authority, one state fan-out path, one capability gateway, and one operational journal authority.
4. **Mutating operations are idempotent.** Every durable/destructive command has a stable operation ID and duplicate execution protection.
5. **Events are append-only facts.** Current state is projected from authoritative facts; snapshots accelerate recovery but do not replace history.
6. **Capabilities replace broad booleans.** Roles map to explicit capabilities that can be evaluated and revoked at runtime.
7. **Workers fail independently.** A failed game, AI, Discord, or notification worker must not terminate Nexus Core.
8. **Context is scoped.** A module or AI worker receives only the user/server/module context and secrets it is authorized to consume.
9. **The renderer remains a control surface.** Business rules live behind stable Core contracts rather than in DOM/UI code.
10. **Releases are evidence-gated.** No production tag or release is implied by checkpoint completion; release authorization remains separate.

## Checkpoint execution model

Each checkpoint has a **Gate**. A checkpoint is complete only when its acceptance criteria are covered by automated tests and the affected existing test suites remain green. Later checkpoints may begin with additive, non-invasive contracts while an earlier migration is being completed, but no irreversible cutover may skip an open Gate.

---

## NX-CP00 — Stabilize the Foundation

**Status:** IN PROGRESS

### Goal
Make the current v0.40.x development line a trustworthy baseline before deeper Core migration.

### Work
- Enforce the renderer shared-state hub as the sole `app state` IPC subscriber.
- Remove heartbeat-driven remount/fan-out regressions.
- Keep updater, module runtime, navigation, and status UI behind the shared state path.
- Restore green CI and Windows build checks.
- Preserve current release metadata and updater protections.

### Gate
- Zero renderer files except `renderer/state-hub.js` subscribe directly to `window.khaos.onState`.
- State hub loads safely before or independently of consumers.
- Full Node test suite green.
- Windows build workflow green.
- No new production release/tag is created as part of the checkpoint.

---

## NX-CP01 — Nexus Core Contracts

**Status:** STARTED

### Goal
Define small, dependency-light contracts that every later migration can share without forcing an immediate rewrite.

### Work
- Canonical event envelope.
- Canonical action/command envelope.
- Stable correlation, causation, and idempotency identifiers.
- Actor + source identity fields.
- Capability requirement fields.
- Result envelope for deterministic execution.
- Validation/freeze helpers and contract tests.

### Gate
- Contracts are pure CommonJS modules with no Electron/Discord/game dependencies.
- Invalid envelopes fail closed.
- Valid envelopes are immutable after construction.
- Existing modules can adopt the contracts incrementally.
- Contract unit tests are green.

---

## NX-CP02 — Operational Event Journal + Projections

**Status:** PARTIAL PATTERNS EXIST

### Goal
Generalize the existing repair/D&D/scheduler event patterns into one operational journal for Nexus Core.

### Work
- Append-only event writer.
- Monotonic sequence per journal scope.
- Projection API for reconstructing current state.
- Snapshot contract with version/checksum metadata.
- Replay boundaries and schema-version handling.
- Correlation search for audit/debugging.

### Gate
- Restart/recovery can reconstruct a representative workflow from journal + snapshot.
- Duplicate event IDs are rejected or treated idempotently.
- Journal never contains raw secrets.
- Projection output is deterministic for identical input.

---

## NX-CP03 — Capability Gateway

**Status:** PARTIAL PATTERNS EXIST

### Goal
Promote adapter/module role checks into a single capability authorization system.

### Work
- Canonical capability registry (`ark.restart`, `discord.roles.manage`, `scheduler.jobs.create`, etc.).
- Role-to-capability mapping.
- Per-module and per-worker capability manifests.
- Runtime deny/revocation support.
- Policy decision record emitted to the journal.
- Explicit AI capabilities defaulting to propose/read-only.

### Gate
- Privileged execution cannot occur without a capability decision.
- Capability denial is deterministic and auditable.
- Veyra/Sentinel boundaries remain at least as restrictive as today.
- Existing Owner/Community Manager/admin semantics map without privilege expansion.

---

## NX-CP04 — Command / Execution Gateway

**Status:** PARTIAL PATTERNS EXIST

### Goal
Create one path for mutating work: request → authorize → deduplicate → execute → verify → journal result.

### Work
- Structured command dispatcher.
- Idempotency store/lock contract.
- Capability evaluation before adapter execution.
- Timeout/cancellation semantics.
- Verification hooks for destructive operations.
- First migrations: server save/broadcast/restart and a safe Discord mutation.

### Gate
- Retrying the same operation ID cannot execute the destructive action twice.
- Raw AI output cannot directly become RCON/shell/database commands.
- Success/failure/rollback outcomes are journaled under one correlation chain.

---

## NX-CP05 — Supervisor + Worker Runtime

**Status:** PARTIAL PATTERNS EXIST

### Goal
Generalize the proven AI Runtime host supervision model into reusable worker infrastructure.

### Work
- Worker lifecycle contract: start, ready, health, stop, crash, restart.
- Bounded restart policy with circuit-breaker state.
- Per-worker authority/environment contract.
- Failure isolation.
- Unified health projection for the desktop monitor.

### Gate
- A deliberately failed worker does not terminate Core or unrelated workers.
- Restart loops are bounded and visible.
- Worker authority can only narrow Core authority, never expand it.

---

## NX-CP06 — Durable Shared Scheduler

**Status:** SHARED SCHEDULER EXISTS; DURABILITY MIGRATION PLANNED

### Goal
Make the existing shared scheduler the exclusive owner of scheduled and delayed execution.

### Work
- Durable job IDs and idempotency IDs.
- Claim/lock/lease semantics.
- Misfire policy.
- Crash recovery without destructive replay.
- Common job history and result events.
- Migrate remaining module/AI timers that represent durable work.

### Gate
- No module owns a second durable scheduler.
- Restarting Nexus cannot double-run an interrupted destructive job.
- Job history is reconstructable from the journal.

---

## NX-CP07 — Context + Knowledge Isolation

**Status:** PARTIAL AI BOUNDARIES EXIST

### Goal
Create a context broker that returns the minimum authorized context for a task.

### Work
- User, Discord guild, module, server, campaign, and session scopes.
- Retrieval policy by worker/tool.
- Secret redaction before context leaves Core.
- Veyra D&D context policy becomes a formal scoped grant.
- Sentinel remains excluded from D&D context.

### Gate
- Automated tests prove cross-scope data does not leak.
- Secrets never enter model prompts or journal payloads unless an explicit redacted representation is defined.
- Context grants are auditable.

---

## NX-CP08 — AI Tool Gateway

**Status:** PARTIAL AGENT AUTHORITY MODEL EXISTS

### Goal
Expose useful Nexus actions to AI through typed tools while keeping deterministic authority in Core.

### Work
- Tool registry backed by Core command contracts.
- JSON-schema or equivalent argument validation.
- Capability requirement per tool.
- Proposal/approval/execute modes.
- Human approval path for high-impact operations.
- Redacted tool results returned to agents.

### Gate
- No AI worker has raw RCON, shell, unrestricted SQL, scheduler ownership, or Discord-token access.
- High-impact operations require the configured approval level.
- Tool calls and results share a correlation chain in the event journal.

---

## NX-CP09 — Thin Control Surface Migration

**Status:** PARTIAL; STATE HUB EXISTS

### Goal
Turn the Electron renderer into a projection-driven control surface over Nexus Core.

### Work
- One renderer state subscription hub.
- Stable view-model projections.
- UI requests structured commands instead of embedding business policy.
- Remove duplicate module-specific state polling where Core state can push updates.
- Preserve accessibility and low-remount performance work.

### Gate
- Renderer has no direct privileged infrastructure access.
- Heartbeats update data without rebuilding stable navigation/cards.
- UI reconnect can replay/get the latest projection without duplicating actions.

---

## NX-CP10 — Release Engineering + Recovery

**Status:** IN PROGRESS IN v0.40.x LINE

### Goal
Make release confidence a property of the pipeline rather than manual hope.

### Work
- Clean-install Windows smoke test.
- Cold-start and first-run checks.
- Migration validation.
- Single-connection assertions.
- Shared-scheduler recovery test.
- Worker startup/shutdown test.
- Updater backup/verification/install-path test.
- Artifact metadata/version consistency checks.

### Gate
- CI and Windows build green from the approved release candidate commit.
- Packaged app cold-starts from a clean profile.
- Recovery tests show no duplicate destructive work.
- Release remains an explicit Owner-approved action.

---

## NX-CP11 — Nexus Core v1 Cutover

**Status:** PLANNED

### Goal
Make the new Core paths authoritative and remove temporary compatibility paths only after all required modules have migrated.

### Work
- Inventory bypass/legacy paths.
- Migrate remaining privileged operations.
- Delete compatibility shims only with tests proving no active consumer remains.
- Freeze Core v1 public/internal contracts and document extension rules.

### Gate
- Architecture enforcement tests prevent direct scheduler, state, capability, AI-authority, and privileged execution bypasses.
- All enabled production modules use Core authority paths.
- Rollback procedure is documented and tested.

---

## Current implementation slice

This branch begins with two additive/safe slices:

1. **NX-CP00:** finish renderer single-state-authority enforcement and remove the current CI fan-out violation.
2. **NX-CP01:** introduce the first dependency-free Nexus Core event/action contracts and tests without rewiring live execution yet.

No release, tag, migration of persistent user data, or destructive production operation is authorized by this roadmap.
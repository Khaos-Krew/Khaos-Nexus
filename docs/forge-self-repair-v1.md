# Khaos Nexus Forge Self-Repair

Status: **observation + manual handoff only**

The Self-Repair subsystem gives Nexus Sentinel a zero-AI incident observer for the local Nexus runtime and the authenticated Sentinel -> Forge bridge. It deliberately separates **detection, incident management, handoff preparation, verification, and execution**.

Execution is still owned by the existing staff-confirmed `/forge` path. Self-Repair itself cannot invoke model-backed Forge tasks.

## What it observes

- Nexus Backend `/health`
- Sentinel Admin public `/health`
- Forge runtime `/health`
- Authenticated Forge CI status for `FORGE_DEFAULT_BASE_REF`
- Failed GitHub check runs returned by Forge
- Sentinel process uptime and bounded non-secret memory metrics
- Self-Repair persistent state-directory writability

The default observation interval is 5 minutes, with a 30-second startup delay.

The optional RSS warning threshold is disabled by default. If `NEXUS_FORGE_SELF_REPAIR_RSS_WARN_MB` is set above zero, crossing that threshold creates a hold-only runtime incident; it does not restart Sentinel or automatically modify code.

## Incident lifecycle

The observer:

1. Collects a bounded, secret-safe health/CI/runtime snapshot.
2. Classifies service, authentication, protected-CI-probe, CI, persistence, and optional memory-pressure failures.
3. Generates a stable incident ID from non-secret evidence.
4. Assigns severity and prepared-action risk.
5. Deduplicates repeated observations of the same incident.
6. Persists incident lifecycle state under `/app/data/forge-self-repair-observer.json` by default.
7. Appends staff/incident lifecycle events to `/app/data/forge-self-repair-audit.ndjson` by default.
8. Marks incidents resolved only when the failing condition disappears.
9. Reopens recurring incidents without discarding prior occurrence history.
10. Prepares an inert Forge repair candidate describing the recommended next action.

A CI failure on an existing `forge/*` ref prepares a `repair` candidate. A CI failure on the normal Nexus base ref prepares a guarded `build` candidate. Forge runtime/authentication failures, runtime-memory warnings, and Self-Repair persistence failures prepare `hold` candidates.

## Hard safety policy

The safety policy is code-enforced and reports the following mode:

- `executionMode: manual-confirmation-only`
- automatic planning: **disabled**
- automatic repair execution: **disabled**
- automatic PR merge: **disabled**
- automatic deployment: **disabled**
- automatic Sentinel/game-server restart: **disabled**
- staff confirmation: **required**

Self-Repair does **not** call `ForgeClient.plan()` or `ForgeClient.execute()`.

Every prepared candidate records:

- `observationOnly: true`
- `aiInvoked: false`
- `automaticExecutionAllowed: false`
- `requiresStaffConfirmation: true`

The existing guarded `/forge build` and `/forge repair` controls remain the separate execution path and retain their confirmation gate.

## Staff commands

- `/selfrepair status` — show observer health, current incident count, CI target, and runtime memory summary.
- `/selfrepair check` — run a fresh health/CI/runtime observation pass. Uses **0 AI/model tokens**.
- `/selfrepair incidents` — show recent incidents and their inert prepared action.
- `/selfrepair detail incident:<id>` — show one incident, severity/risk, evidence summary, and policy blockers.
- `/selfrepair ack incident:<id> [note]` — acknowledge an open incident without resolving it.
- `/selfrepair snooze incident:<id> minutes:<n>` — suppress manual handoff for a bounded period while observation continues.
- `/selfrepair unsnooze incident:<id>` — remove the snooze.
- `/selfrepair prepare incident:<id>` — build the manual `/forge build` or `/forge repair` handoff text without invoking Forge AI.
- `/selfrepair verify incident:<id> [branch]` — rerun observation plus optional protected branch CI verification. Uses **0 AI/model tokens**.
- `/selfrepair policy` — show the hard safety policy and alert state.

Acknowledging or snoozing never marks an incident resolved. Resolution remains evidence-driven.

## Verification

Verification is deliberately separate from repair execution.

A verification pass:

1. reruns the same zero-AI observer checks;
2. confirms whether the original incident condition cleared;
3. optionally checks a provided `forge/*` branch through authenticated Forge CI;
4. records the result on the incident and in the audit journal;
5. never calls `plan()` or `execute()`.

`NEXUS_FORGE_SELF_REPAIR_VERIFY_PASSES` controls the required consecutive passing verifications and is clamped to 1–5. Default: `1`.

## Optional Discord incident alerts

The notifier is built but **disabled by default**.

When explicitly enabled and given a channel, it can post bounded no-mention incident-opened and incident-resolved messages. Notifications do not trigger repair work.

- `NEXUS_FORGE_SELF_REPAIR_ALERTS_ENABLED=false` by default
- `NEXUS_FORGE_SELF_REPAIR_ALERT_CHANNEL_ID` — required to actually send alerts
- `NEXUS_FORGE_SELF_REPAIR_ALERT_RESOLVED=true` by default

## Environment controls

- `NEXUS_FORGE_SELF_REPAIR_OBSERVER_ENABLED` — default `true`; set `false` to disable the observer.
- `NEXUS_FORGE_SELF_REPAIR_INTERVAL_SECONDS` — default `300`; clamped to 60–3600 seconds.
- `NEXUS_FORGE_SELF_REPAIR_STATE_FILE` — optional state-file override.
- `NEXUS_FORGE_SELF_REPAIR_AUDIT_FILE` — optional append-only audit-journal override.
- `NEXUS_SENTINAL_ADMIN_HEALTH_URL` — optional Sentinel Admin health URL override.
- `NEXUS_FORGE_SELF_REPAIR_MAX_SNOOZE_MINUTES` — default `1440`; clamped to 5–10080 minutes.
- `NEXUS_FORGE_SELF_REPAIR_VERIFY_PASSES` — default `1`; clamped to 1–5.
- `NEXUS_FORGE_SELF_REPAIR_RSS_WARN_MB` — default `0` (disabled).
- `NEXUS_FORGE_SELF_REPAIR_ALERTS_ENABLED` — default `false`.
- `NEXUS_FORGE_SELF_REPAIR_ALERT_CHANNEL_ID` — optional staff alert channel.
- `NEXUS_FORGE_SELF_REPAIR_ALERT_RESOLVED` — default `true`.

Forge connectivity continues to use the existing `FORGE_*` variables. Nexus Backend health uses `NEXUS_BACKEND_URL`.

## State compatibility

State schema V2 migrates V1 observer state in place when read. Existing incident IDs, evidence, seen counts, and lifecycle timestamps are retained while the new acknowledgement, snooze, recurrence, severity/risk, and verification fields are added with safe defaults.

## Not built/enabled yet

The following remain intentionally absent from the active execution path:

- automatic model-backed diagnosis;
- automatic repair submission;
- automatic branch creation from Self-Repair;
- token/cost spending by the observer;
- automatic merge;
- automatic Railway deployment;
- automatic Sentinel restart;
- automatic hosted game-server restart;
- automatic rollback.

Those can be implemented later behind explicit cost, approval, maintenance-window, rollback, and production-verification policy. Until then, the subsystem is designed to do the expensive part operationally—detecting, deduplicating, recording, and preparing the exact work—without spending model tokens or changing production.

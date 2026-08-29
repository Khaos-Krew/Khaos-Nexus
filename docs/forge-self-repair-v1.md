# Khaos Nexus Forge Self-Repair V1

Status: **observation-only**

Self-Repair V1 gives Nexus Sentinel a zero-AI incident observer for the local Nexus runtime and the authenticated Sentinel -> Forge bridge. It deliberately separates **detection/preparation** from **execution**.

## What V1 observes

- Nexus Backend `/health`
- Sentinel Admin public `/health`
- Forge runtime `/health`
- Authenticated Forge CI status for `FORGE_DEFAULT_BASE_REF`
- Failed GitHub check runs returned by Forge

The default observation interval is 5 minutes, with a 30-second startup delay.

## Incident behavior

The observer:

1. Collects a bounded, secret-safe health/CI snapshot.
2. Classifies service, authentication, protected-CI-probe, and CI failures.
3. Generates a stable incident ID from non-secret evidence.
4. Deduplicates repeated observations of the same incident.
5. Persists incident lifecycle state under `/app/data/forge-self-repair-observer.json` by default.
6. Marks incidents resolved when the failing condition disappears.
7. Prepares an inert Forge repair candidate describing the recommended next action.

A CI failure on an existing `forge/*` ref prepares a `repair` candidate. A CI failure on the normal Nexus base ref prepares a guarded `build` candidate. Forge runtime/authentication failures prepare a `hold` candidate because Forge must recover before it can safely repair anything.

## Hard safety boundary

Self-Repair V1 does **not** call `ForgeClient.plan()` or `ForgeClient.execute()`.

Every prepared candidate records:

- `observationOnly: true`
- `aiInvoked: false`
- `automaticExecutionAllowed: false`
- `requiresStaffConfirmation: true`

The observer cannot merge a PR, deploy Railway, restart Sentinel, or restart a hosted game server.

## Staff commands

- `/selfrepair status` — show current observer health and incident count.
- `/selfrepair check` — run a fresh health/CI pass. This uses **0 AI/model tokens**.
- `/selfrepair incidents` — show recent incidents and their inert prepared candidate action.

Existing guarded `/forge build` and `/forge repair` controls remain the separate execution path and keep their confirmation requirements.

## Environment controls

- `NEXUS_FORGE_SELF_REPAIR_OBSERVER_ENABLED` — default `true`; set `false` to disable the observer.
- `NEXUS_FORGE_SELF_REPAIR_INTERVAL_SECONDS` — default `300`; clamped to 60–3600 seconds.
- `NEXUS_FORGE_SELF_REPAIR_STATE_FILE` — optional state-file override.
- `NEXUS_SENTINAL_ADMIN_HEALTH_URL` — optional Sentinel Admin health URL override.

Forge connectivity continues to use the existing `FORGE_*` variables. Nexus Backend health uses `NEXUS_BACKEND_URL`.

## Later phases

A later phase may add policy-controlled automatic repair submission, token budgets, escalation windows, and deployment verification. Those capabilities are intentionally absent from V1 and should not be enabled until their approval, cost, rollback, and production-safety policies are explicit.

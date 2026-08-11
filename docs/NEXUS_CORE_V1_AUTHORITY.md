# Nexus Core v1 Authority Boundary

Status: **Frozen for v0.41.0-B test update**

## Authoritative scope

Nexus Core v1 is the mandatory authority path for operations that can cause an external side effect with meaningful operational or security impact.

The following enabled desktop paths must terminate in the Nexus Core command gateway before the deterministic adapter executes them:

- shared scheduler announcements, saves, and shutdown/restart workflow steps;
- player kick, ban, and unban actions;
- hosted-server start/stop/restart/kill power operations;
- Palworld save, announcement, moderation, graceful shutdown, and immediate stop;
- Rust announcement, save, moderation, graceful shutdown, immediate stop, and raw console command;
- Satisfactory backup, save, graceful shutdown, immediate stop, and raw command;
- Operator Console Maintenance Mode.

Every Core mutation requires:

1. a typed action name;
2. a stable operation/idempotency identifier;
3. a capability decision owned by the registered executor;
4. deterministic adapter execution;
5. a correlated journal result;
6. fail-closed handling when prior completion is uncertain.

## Allowed direct paths

A path does not need the command gateway when it cannot produce the privileged external side effects above. Examples include:

- status, health, player-list, metrics, settings-read, and other read-only adapter queries;
- local UI projection/rendering;
- local configuration editing that is already guarded by desktop access control and does not itself execute an external command;
- local file export/dialog interactions;
- certificate inspection/trust configuration;
- diagnostics and redacted audit reads.

These paths still must not expose protected secrets to the renderer or AI workers.

## AI authority

Nexus Sentinel and Veyra remain isolated workers with separate domain context. Nexus Sentinel is denied campaign/D&D-session context. Veyra is denied server/module/hosted-server context.

AI tools are typed, schema-validated Core registrations. AI workers do not receive raw RCON, shell, unrestricted SQL, protected Discord tokens, scheduler ownership, or arbitrary database authority. High-impact tool execution fails closed unless Core receives a deterministic approved execution subject.

Current Nexus Sentinel operations remain read/advisory; its service contract explicitly advertises `directExecution: false`. No destructive AI action is enabled merely because the Core tool gateway exists.

## State and recovery

- `renderer/state-hub.js` is the only renderer subscriber to app-state IPC.
- The append-only Core event journal is the operational history authority.
- Projection snapshots are checksummed and versioned.
- An operation found in `running` state after process restart is changed to `uncertain`, not replayed.
- An uncertain destructive operation keeps its idempotency lock until explicit operator review/recovery policy handles it.
- The shared scheduler similarly fails interrupted workflows closed instead of automatically replaying destructive stages.

## Cloud boundary

Railway `just-warmth` may host future public ingress, relay, synchronization, or explicitly scoped workers. It is not the authority for raw game credentials, the primary journal, the singleton scheduler, update installation, release authorization, or desktop protected storage.

## Update boundary

Stable remains the default update channel. v0.41.0-B is the bridge update that adds an opt-in Test/Beta channel for later prerelease builds.

The v0.41 protected publisher validates tests, packaged contents, embedded AI runtimes, packaged startup, clean install, updater metadata, and signature policy before creating the immutable release tag and latest GitHub release. Pre-update backup verification remains mandatory inside the installed update flow.

## Compatibility rule

A compatibility shim may remain after Core v1 only when it does not provide an alternate privileged execution path. Architecture tests must fail if a new enabled game mutation or AI authority path is introduced outside Core.

# Khaos Nexus Cinematic Startup HUD

## Goal

Replace the basic protected-startup presentation with a production-grade Khaos Nexus boot interface inspired by high-end AI command HUDs while preserving the existing startup-health, recovery, renderer-gate, timeout, and limited-mode behavior.

This change is intentionally a presentation and observation layer. It does **not** weaken, bypass, or redefine the startup release prerequisites owned by `startup-health-extension.cjs`.

## Visual direction

The startup view uses the approved Nexus direction:

- black / charcoal command-center surface
- crimson holographic rings and scanning elements
- central Nexus core built from local assets and CSS layers
- left-side Nexus diagnostics
- right-side boot sequence
- real protected-startup progress
- bottom subsystem strip
- `WHERE CHAOS MEETS CONTROL` footer branding

The interface borrows the clarity and layered instrumentation of cinematic AI HUDs, with only a restrained industrial influence. It does not use Lost Colony terminology or fictional colony telemetry.

## Runtime components

### `main/startup-health-extension.cjs`

Remains authoritative for startup safety and release state. It continues to own:

- profile recovery and profile validation
- configuration validation
- retained data integrity
- user-data write access
- Windows secure storage availability
- loaded service configuration
- Discord access restoration observation
- renderer bridge readiness
- renderer module readiness
- startup timeout behavior
- release gating
- limited-mode release

### `main/startup-hud-extension.cjs`

Adds only HUD-specific runtime behavior:

- monitor-aware splash sizing and centering
- widescreen cinematic layout bounds
- safe non-secret runtime metadata for the splash UI

The metadata bridge exposes application/runtime identity only: app version, platform, architecture, Electron version, CPU thread count, hostname, and whether secure storage is available. No credentials or protected values are exposed.

### `main/startup-health-preload.cjs`

Keeps the existing isolated startup-health bridge and adds `getMeta()` for the HUD metadata channel.

### `renderer/startup-health.html`

Defines the visual hierarchy:

1. Nexus header and runtime identity
2. Nexus diagnostics panel
3. animated Nexus core
4. real boot progress and release gate
5. boot-sequence panel
6. Nexus overview
7. subsystem status strip
8. recovery / limited-mode controls

### `renderer/startup-health.js`

Maps the existing startup-health state into the HUD. It does not fabricate success states.

## State mapping

| HUD surface | Authoritative source |
| --- | --- |
| Core | profile location, config file, data integrity, write access, config store |
| Security | Windows secure storage |
| Modules | renderer module loading |
| Network | Discord restore state; optional for local startup |
| AI Core | `STANDBY` until a real AI startup signal is added |
| Command | startup completion and release state |
| Renderer bridge | protected renderer bridge readiness |
| System integrity | aggregate of critical startup checks |
| Progress | existing health checks plus renderer readiness and release gate |

## Boot sequence presentation

The right-hand sequence groups existing low-level checks into Nexus-facing language:

1. Load Nexus Profile
2. Verify Security Matrix
3. Restore Command Config
4. Load Command Modules
5. Connect Discord Services
6. Initialize Renderer Bridge
7. Launch Command Center

Discord remains optional for local startup. Warnings remain visible rather than being falsely presented as successful connections.

## Recovery behavior

The existing recovery controls remain available when critical startup checks fail or startup times out:

- Retry Startup
- Open Data Folder
- Open Limited Mode

The HUD changes presentation only; the existing IPC actions remain authoritative.

## Performance and accessibility

- no remote assets or external fonts
- local Nexus icon only
- CSS-driven animation rather than a video dependency
- no WebGL requirement
- compatible with software-rendering startup paths
- `prefers-reduced-motion` disables continuous animation
- responsive sizing for smaller desktop work areas
- state and recovery regions retain live-region semantics

## Future expansion

Future versions may add additional real telemetry only after an authoritative startup signal exists. Suitable candidates include:

- actual renderer performance samples
- Nexus AI Core health / capability discovery
- bot supervisor state
- scheduler readiness
- module runtime counts

Those values should never be inferred or animated into an online state without a real service signal.

# Khaos Nexus

**Khaos Nexus is a local-first Windows desktop command center for Discord operations, game-server management, shared automation, D&D tooling, diagnostics, and Nexus services.**

The Windows desktop application is the current primary product. Khaos Nexus is undergoing a **stabilization reset**: feature expansion is frozen while the approved desktop shell and core operational workflows are brought back to a dependable baseline.

> **Current development line:** `0.41.x`  
> **Stabilization candidate:** `v0.41.2-B`  
> **Known-good rollback target:** `v0.41.1-B`  
> **Stabilization branch:** `stabilize/nexus-66-baseline`  
> **Stabilization PR:** [#266 — stabilization: establish Nexus 66% golden baseline](../../pull/266)

`Nexus Sentinel 0.33.0 RC1` was a temporary split-product integration candidate. It failed owner acceptance because of desktop shell/loading/navigation regressions and **is not the successor to the Khaos Nexus 0.41 line**.

## Project status

| Area | Current status |
| --- | --- |
| Windows desktop application | **Active — stabilization** |
| `v0.41.2-B` | **Development/test candidate** for the stability baseline; candidate metadata does not by itself mean a GitHub release has been published |
| `v0.41.1-B` | **Rollback target** recorded by the current release identity |
| Nexus Sentinel `0.33.0 RC1` | **Rejected temporary integration line**; retained only as development history/reference |
| Android Companion / Mobile Gateway | **Owner-test validation resumed**; production exposure remains held/disabled pending separate acceptance |
| Feature expansion | **Frozen during stabilization** |
| Self-hosted web/backend migration | **Deferred** until the desktop baseline is accepted |

Published artifacts and tags are a separate concern from development-version metadata. Use the [GitHub Releases page](../../releases) to determine which builds are actually available for download; do not infer publication from `package.json`, a branch, a PR, or release notes alone.

## What Khaos Nexus currently contains

The stabilization branch contains a working Electron desktop codebase with established subsystems for:

- the Khaos Nexus desktop shell, module controls, local configuration, recovery, diagnostics, backups, and update infrastructure;
- supervised Discord bot operation, Discord setup/automation, status/control surfaces, and routed operational output;
- game-server integrations including Palworld REST/RCON, ARK/generic RCON, hosted-server control through the Pterodactyl Client API, and additional adapter work already present in the codebase;
- a shared server scheduler for warnings, saves, shutdown/restart workflows, recovery checks, and execution history;
- D&D campaign tooling and associated local/Discord workflows;
- the Nexus AI runtime work that includes Veyra and Nexus Sentinel services;
- local monitoring, watchdog, support, and recovery tooling.

**Presence in the repository is not the same as current release acceptance.** During the reset, the items below are the explicit stability gates. Other implemented surfaces remain subject to revalidation and should not be described as production-ready merely because their code is present.

## Desktop workspaces and UI boundaries

The current desktop shell includes dedicated presentation/workspace areas for **D&D** and **Nexus AI** alongside the command center, connected systems, modules, and system tooling. These workspaces organize existing services; they do not establish a separate release line or bypass the shared desktop authority boundaries.

The visual layer prioritizes readability and accessibility. Dense operational surfaces retain usable backgrounds, decorative assets do not own input, and motion is reduced when the operating system **requests reduced motion**.

Development, UI-refresh, stabilization, and owner-test branches **must not publish or modify a release channel** merely because their code packages successfully. Release publication remains a separate authorized action. Mobile-only product work remains associated with `Khaos-Krew/nexus-mobile-companion`; Android Companion / Mobile Gateway owner-test validation has been explicitly resumed for the current stabilization effort, while production exposure remains held/disabled until separately accepted.

## Current stabilization gates

A test candidate is evaluated against these 12 functional gates:

1. Startup and loading presentation
2. Sidebar and navigation
3. Settings persistence
4. Discord login/bot supervision
5. Discord status/control panel
6. Palworld server configuration
7. Palworld status/player reads
8. Palworld command/action execution
9. Shared scheduler
10. Module enable/disable
11. Updater/manual release detection
12. Backup/restore

The current stabilization policy requires at least **8/12** gates before an owner test build is appropriate, **10/12** for beta quality, and **12/12** for release-candidate quality. Stabilization does not end until a candidate reaches at least 10/12 with no major UI regression and survives an owner acceptance pass.

See [`docs/NEXUS_STABILIZATION_RESET.md`](docs/NEXUS_STABILIZATION_RESET.md) for the full stabilization contract.

## Roadmap

The public roadmap is synchronized from [`docs/NEXUS_ROADMAP_STATUS.md`](docs/NEXUS_ROADMAP_STATUS.md), which is the canonical roadmap/status handoff for the Nexus Doc Watch.

- **Now — Stabilization Reset:** protect the approved modern desktop shell and reach a dependable functional baseline. Core CI, Windows Build, diagnostics integration, and bundled-AI validation all passed on validated implementation head `41f6933eab1ae592b3539d9dfeb79cf6a7e0311d`; later documentation-only commits advanced PR #266 after that validation. Packaged visual/sidebar/loading proof is still required before the golden-shell phase can exit.
- **Next — Core reliability:** persistence, module control, shared scheduler, backup/recovery, and removal of conflicting legacy paths.
- **Then — Discord + Palworld acceptance:** validate real operational flows without regressing the desktop shell.
- **Release hardening:** keep one release identity and ensure the artifact delivered for testing is the exact packaged build that passed validation.
- **Later — Self-hosted web + Windows agent:** deferred until the desktop baseline is accepted.

Android Companion / Mobile Gateway owner-test validation is running alongside stabilization support work, but it does not lift the production hold or change the primary Windows product line.

The detailed phase and gate status lives in the canonical roadmap document so the README stays concise while the Nexus Doc Watch can keep this summary current from repository evidence.

## Platform and architecture

Khaos Nexus is currently a **Windows x64 Electron desktop application**. The repository separates the privileged main-process runtime, renderer/UI, Discord bot runtime, shared contracts, adapters, and supporting assets.

```text
Windows desktop
├─ Electron main process
│  ├─ protected local configuration / credentials
│  ├─ backups, diagnostics, updater, watchdog
│  ├─ game-server adapters and scheduling
│  └─ supervised service/runtime boundaries
├─ Renderer
│  └─ desktop navigation, status, controls, and module workspaces
├─ Discord bot runtime
│  └─ commands, panels, automation, and Discord delivery
└─ Shared contracts
   └─ common policies, validation, adapter contracts, and safety rules
```

Sensitive credentials are intended to remain outside renderer-visible state. Public-facing Discord output and diagnostic/support paths are designed to avoid exposing protected tokens, passwords, connection details, or private identifiers.

### Future architecture

A longer-term direction may evolve toward a self-hosted **Khaos Nexus Web + Khaos Nexus Backend + lightweight Windows Nexus Agent** architecture. That is **future direction, not the current product architecture**, and the migration is explicitly deferred during stabilization.

## Running from source

For current stabilization work, use the `stabilize/nexus-66-baseline` branch rather than assuming the default branch represents the active desktop source tree.

The Windows helper scripts support a private Node.js runtime and local dependency setup:

1. Check out or extract the stabilization source.
2. Run `Install-and-Run.bat` for the assisted Windows setup, or install dependencies manually and run `npm start`.
3. Run `npm test` and `npm run check` before proposing changes.
4. Use `Build-Windows.bat` or `npm run dist:win` only when Windows packaging validation is required.

See [`RUN_FROM_SOURCE.md`](RUN_FROM_SOURCE.md) for details.

## Windows builds

The current package configuration supports Windows x64 installer and portable targets using names in this form:

- `Khaos-Nexus-Setup-<version>-x64.exe`
- `Khaos-Nexus-Portable-<version>-x64.exe`

A successfully packaged executable is **not automatically an authorized or published release**. Release publication, updater metadata, release notes, artifact identity, rollback identity, and the tested commit must agree before a build can be promoted.

## Security

Repository policy includes the following boundaries:

- Discord tokens, RCON passwords, provider/API credentials, and similar secrets must never be posted in issues or public logs.
- Protected values use operating-system-backed secure storage where supported.
- Renderer/UI code should receive safe projections rather than raw secrets.
- Diagnostic reports and support bundles are expected to be redacted and still require review before sharing.
- Destructive Discord/server actions remain permission-gated and should not bypass the established main-process authority boundaries.

See [`SECURITY.md`](SECURITY.md).

## Documentation

Start with [`docs/README.md`](docs/README.md) for the documentation map and guidance on which records are current versus historical.

Important current references:

- [`docs/NEXUS_STABILIZATION_RESET.md`](docs/NEXUS_STABILIZATION_RESET.md) — active stabilization policy and acceptance gates
- [`docs/NEXUS_ROADMAP_STATUS.md`](docs/NEXUS_ROADMAP_STATUS.md) — canonical roadmap/status source used by Nexus Doc Watch
- [`config/release-identity.json`](config/release-identity.json) — authoritative stabilization version identity
- [`release-notes/v0.41.2.md`](release-notes/v0.41.2.md) — current candidate notes
- [`RUN_FROM_SOURCE.md`](RUN_FROM_SOURCE.md) — Windows source setup and validation
- [`SECURITY.md`](SECURITY.md) — security/reporting rules
- [`SERVER_SCHEDULER_SETUP.md`](SERVER_SCHEDULER_SETUP.md) — scheduler setup and operational safety
- [`PTERODACTYL_SETUP.md`](PTERODACTYL_SETUP.md) — hosted-server provider setup
- [`TEST_BUILDS.md`](TEST_BUILDS.md) — historical owner-test checkpoints; **not** the current release line

## Contributor orientation

During the stabilization reset:

- do not add new product features or modules;
- do not begin the web migration;
- preserve the approved modern desktop shell and navigation behavior;
- keep version, artifact, updater, notes, and rollback metadata synchronized;
- treat owner-reported regressions as candidates for permanent automated guards;
- do not treat a roadmap, old test build, branch name, PR title, or unmerged implementation as evidence that a capability is currently released;
- do not publish or authorize releases as part of ordinary development/documentation work.

For the exact golden-UI invariants and release gates, read [`docs/NEXUS_STABILIZATION_RESET.md`](docs/NEXUS_STABILIZATION_RESET.md) before changing the desktop baseline.

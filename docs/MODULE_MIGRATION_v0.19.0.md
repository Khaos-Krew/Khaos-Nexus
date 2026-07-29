# Khaos Nexus v0.19.0 Module Migration

## Definition of completion

The migration is complete when every catalog entry has an authoritative lifecycle state and every runnable desktop capability is controlled by the same owner module system.

Completion does **not** mean pretending that every older website idea already has working desktop code. Modules without a runnable implementation remain classified as `planned`, cannot become effectively enabled, and stay out of active navigation until their service and interface are built and validated.

## Authoritative lifecycle

Each module now carries two separate states:

- **Requested state** — the Owner's saved enable or disable choice.
- **Effective state** — whether the module can actually run after implementation availability and dependencies are checked.

Availability is explicit:

- `implemented` — runnable and eligible for Owner enablement.
- `partial` — a safe foundation exists, but unfinished operations remain unavailable.
- `planned` — inventoried only; it cannot masquerade as a working module.

Owner overrides are stored separately from migration progress. Extension migrations may update inventory or validation progress, but they cannot silently overwrite an Owner-disabled module.

## Owner controls

The Modules workspace now provides:

- individual Owner enable and disable switches;
- **Disable All** for repair work;
- **Safe Mode**, leaving diagnostics and backups available while optional operational modules are disabled;
- **Enable Validated**, enabling every implemented module while planned modules remain unavailable;
- dependency-aware `Blocked` state instead of deleting dependent choices;
- runtime navigation removal and protected IPC denial for disabled modules;
- live configuration delivery to the supervised Discord runtime;
- module-aware Discord slash-command registration;
- blocking for old published Discord buttons when their module is disabled.

Expected Owner module blocks are treated as normal control outcomes and are not uploaded as application defects.

## Promoted implemented modules

The v0.19.0 registry promotes the following existing desktop implementations to live/implemented status:

- Discord Runtime
- Game Server Control
- Palworld Operations
- ARK Server Operations
- Application Monitor
- Backup & Update Center
- Operator Console
- Embed Studio
- Role Menus
- Color Roles
- Discord Organization
- Discord Audit Logging
- Discord Observability
- Admin Command Center
- Server Status Panels
- Server Scheduler
- Players & Moderation
- Pterodactyl Control

The existing mobile pairing and security contract remains `partial`: its settings, roles, revocation and pairing preview are present, but no network listener or Android transport is enabled.

## Planned modules retained honestly

The following catalog groups remain planned until their actual desktop services are implemented:

- community directory and discovery;
- rank gifting, progression and economy;
- merch/support store and wallpapers;
- broad moderation, verification and ticket workflows beyond current role/audit controls;
- Twitch and creator automations;
- companion databases and content tools that currently have no desktop data source;
- future game adapters listed in the game-integration research document.

A planned module may have migration notes and source-route inventory, but the Owner cannot switch it into an effective running state.

## Dependency rules

Examples:

- disabling **Discord Runtime** blocks status panels, role menus, color roles, embeds, organization and observability;
- disabling **Game Server Control** blocks Palworld, ARK, scheduler, player console and server status panels;
- disabling **Application Monitor** blocks Discord Observability error delivery;
- disabling **Admin Command Center** blocks the Mobile Companion foundation;
- disabling **Backup & Update Center** blocks backup and update actions without deleting saved configuration.

When the dependency returns, requested child modules become active again automatically.

## Runtime surfaces covered

Owner switches are enforced across:

- sidebar and grouped navigation;
- dynamic module workspaces;
- main-process IPC handlers;
- Discord supervised process start;
- Application Monitor batching;
- update checks, downloads and installs;
- autonomy health, recovery, maintenance and backups;
- scheduled server workflows;
- status-panel publishing and refresh;
- Discord observability delivery;
- slash-command registration and execution;
- Discord status-panel buttons;
- Discord role-menu and color-role buttons.

## Regression coverage

The v0.19.0 tests verify:

- registry uniqueness and dependency validity;
- implemented, partial and planned classification;
- persistence of Owner overrides when a migration tries to re-enable a module;
- dependency blocking without loss of requested state;
- refusal to run planned modules;
- view and IPC mapping;
- Discord command filtering;
- old Discord button blocking;
- expected module-denial filtering;
- production extension order;
- restoration of the complete supervised Discord entry chain.

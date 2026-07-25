# Khaos Nexus v0.14 audit and repair plan

## Executive finding

Khaos Nexus has working individual features, but the desktop application accumulated them through a long chain of runtime extensions and draft branches. The result is fragile load ordering: several modules patch the same Electron classes, inject scripts after the page loads, and depend on other extensions having already captured service instances. This explains why a change can pass isolated unit tests and Windows packaging while the real application still freezes, loses click handlers, or raises a main-process exception.

v0.14 is a stabilization and product-quality pass. No new destructive controls will be enabled until the boot pipeline, diagnostics, permissions, and release channel are reliable.

## Critical findings

### 1. No canonical integrated application branch

Most production functionality lives in a sequence of open draft pull requests rather than one canonical application branch. New releases are built from the newest feature branch while `main` remains far behind. This makes comparisons, releases, updates, and hotfixes harder to reason about and causes very large PRs that appear to add the application from scratch.

Repair:
- create a single audited v0.14 integration branch from the latest validated source;
- stop using old draft PRs as implicit dependencies;
- keep release branches immutable and generated only from the audited integration commit;
- merge only after explicit owner approval.

### 2. Runtime monkey-patch chain

Branding, Palworld, Discord Studio, mobile, Discord Automation, module migration, access recovery, and stability features patch classes or `BrowserWindow.loadFile` at runtime. Multiple wrappers attach `did-finish-load` handlers and inject scripts dynamically.

Risks:
- load-order dependency;
- duplicate IPC handlers;
- partial renderer initialization;
- extension failure can leave the page visible but inert;
- difficult stack traces and error fingerprints;
- tests do not reproduce the packaged boot sequence.

Repair:
- move styles and renderer scripts into one explicit manifest;
- move IPC registration into one registry;
- instantiate services directly in one application container;
- retain compatibility adapters only while a feature is migrated;
- add a packaged boot smoke test.

### 3. Main-process errors hide the actual failure

The native error dialog shows only a fingerprint. The detailed stack remains in a local file that is difficult for the operator to find, and the popup offers no copy/open action.

Repair:
- create a redacted crash report for every main-process exception;
- show the short error plus buttons to copy details and open diagnostics;
- include boot phase, application version, renderer state, and recent safe log entries;
- prevent repeated dialogs for the same fingerprint.

### 4. Renderer health detection can create new errors

The recovery watchdog accesses Electron window and webContents objects from asynchronous callbacks. Destroyed objects, overlapping recovery prompts, and heartbeat races must be treated as normal lifecycle states rather than uncaught exceptions.

Repair:
- capture immutable webContents IDs when attaching listeners;
- check destruction before every access;
- handle all recovery promises;
- never display a modal recovery prompt from a destroyed or closing window;
- add lifecycle tests for close, reload, renderer crash, and full restart.

### 5. UI architecture is page-first rather than task-first

The current sidebar exposes implementation modules directly and grows vertically as features are added. The website provided clearer information architecture by grouping tools into Servers, Games, Discord, Community, Account, and Admin.

Repair:
- use five primary workspaces: Command, Operations, Discord, Community, and Library;
- place Settings, Logs, Monitor, Updates, and Access in a compact System area;
- provide a workspace switcher and command palette;
- show only enabled and authorized destinations;
- keep the current red/black Nexus identity while improving spacing, hierarchy, motion, responsive behavior, and accessibility.

### 6. Discord visibility is fragmented

Status panels, GitHub reports, application updates, bot health, and local logs are separate systems. Operators cannot route each event type to its own Discord channel.

Repair:
- add a Discord Observability service with independent routes for releases, errors, heartbeat, and health events;
- allow a different Discord channel and optional role mention for each route;
- edit one persistent heartbeat message instead of creating repeated messages;
- publish redacted error IDs and recovery context without secrets;
- deduplicate health transitions and release announcements;
- provide test, preview, delivery history, and last-error state for every route.

### 7. Tests do not exercise packaged startup sufficiently

Unit tests cover many services, but packaged behavior includes Electron lifecycle, extension ordering, dynamic script injection, native menu installation, auto-start, access recovery, and updater initialization.

Repair:
- add static duplicate-handler and renderer-manifest checks;
- add an Electron boot smoke test in CI;
- assert one handler per IPC channel;
- assert every visible navigation target has a view and controller;
- fail packaging if required update assets or release metadata are missing.

## Discord Observability acceptance criteria

### Release feed
- independent enabled switch and channel;
- sends a message when a stable version becomes available;
- sends a confirmation after a version is installed;
- includes current version, latest version, release notes summary, and trusted GitHub release link;
- never announces the same version twice unless manually tested.

### Error feed
- independent enabled switch and channel;
- sends redacted error ID, source, severity, occurrence time, and safe summary;
- includes the GitHub issue URL when Application Monitor creates one;
- duplicate fingerprints update occurrence information rather than spamming;
- no tokens, passwords, host addresses, or raw protected configuration.

### Heartbeat panel
- independent enabled switch, channel, and interval;
- one persistent Discord message edited in place;
- shows app version, desktop uptime, bot state, bot heartbeat age, Discord guild count, memory, configured server totals, enabled modules, updater state, and last safe error ID;
- stale data is shown as unknown or degraded, never falsely online;
- manual refresh and recreate controls.

### Health events
- independent enabled switch and channel;
- sends only state transitions: starting, online, stopped, degraded, error, recovered, server offline, server recovered, updater failed;
- configurable minimum severity and cooldown;
- manual test event.

## UI target

The v0.14 interface should feel like a purpose-built futuristic operations product rather than a collection of forms:

- Nexus crest remains the primary identity;
- metallic black surfaces, deep red energy, and restrained cyan telemetry accents;
- compact top command bar with global search, active role, runtime status, version, and update state;
- grouped navigation with collapsible workspace sections;
- responsive content width with no dead black area;
- dashboard composed of live status rail, urgent tasks, recent events, servers, Discord delivery health, and migration progress;
- consistent cards, tables, filters, empty states, confirmation dialogs, and toasts;
- keyboard navigation and visible focus states;
- readable dropdowns and form controls in every Windows theme.

## Delivery sequence

1. Crash diagnostics and Electron lifecycle repair.
2. Explicit boot manifest and IPC registry inventory.
3. Discord Observability model, service, tests, and configuration UI.
4. New Nexus shell and navigation architecture.
5. Migrate existing views into the new shell without changing service behavior.
6. Packaged boot smoke tests and Windows validation.
7. Stable release only after owner testing of portable build.

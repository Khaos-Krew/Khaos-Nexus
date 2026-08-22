# Rebuild Scope — Nexus 0.1

## Decision

The previous 0.41.x desktop line is preserved as legacy/reference. The rebuild resets versioning to **0.1.0** and does not inherit the previous extension-heavy renderer architecture.

## Desktop scope

Keep only:

- Discord/Sentinel administration
- Account linking and access control
- Backend module enable/disable, channel binding and service health
- Diagnostics, logs, support/recovery tooling
- Shared scheduler administration
- Integration/credential configuration using protected storage
- Private Thora launch/status bridge

Do not re-add routine game dashboards, player views, build planners, news feeds or game-control pages to Electron. Those belong in backend services surfaced through Sentinel/Veyra.

## Migration policy

Old code is reference material, not an automatic dependency. Port a legacy component only when its behavior is understood, covered by tests and fits the new service boundary.

## First backend modules

ARK, Palworld, Minecraft, Warframe, Division 2, Rust, Satisfactory, IdleOn and D&D are registered from day one. Provider transports are added one module at a time without changing Sentinel's module-console contract.

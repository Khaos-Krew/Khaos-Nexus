# Khaos Nexus Rebuild Baseline

This file is the authoritative minimum rebuild baseline after the September 2026 infrastructure cleanup.

## Objective

Keep only the systems that are required to operate Khaos Nexus today, preserve stateful data, and make the ARK plugin rebuild straightforward when plugin access is available again.

## Railway minimum

### Khaos Nexus Core
Keep:
- `nexus-sentinal-0-1-test` — current Sentinel core and ARK control profile; preserve `/app/data` volume
- `chaos-nexus-hub` — Discord hub/bot
- `ARN` — Anomaly Response Network
- `nexus-ark-dynamic-config` — ARK dynamic configuration proxy
- `Postgres` — shared operational database; preserve database volume
- `KNX-BUILD-NODE-02` — ARK-specialized worker lane
- `KNX-BUILD-NODE-03` — general worker lane

Remove:
- `KNX-BUILD-NODE-01` — redundant; no production references or unique responsibility

### Nexus D&D
Keep:
- `nexus-dnd-activity`
- `nexus-state-volume`

Remove all branch preview services. Preview infrastructure must not be long-lived production infrastructure.

### Veyra
Keep:
- `Veyra - Lore Master`
- `Veyra - Discord Gateway`

### Khaos Nexus Forge
Keep separate:
- `khaos-nexus-forge`
- Forge persistent volume

Forge remains an isolated lifecycle and failure domain.

### Thora
Keep, but paused/sealed:
- `Thora-Desktop`
- `thora-desktop-updates` volume

Remove:
- `Thora-Desktop-v010-preview`

Do not expand Thora during the Nexus rebuild unless it becomes an explicit active priority.

## GitHub authoritative repos

### Active core
- `Khaos-Krew/Khaos-Nexus`
- `Khaos-Krew/ARN`
- `Khaos-Krew/Nexus-DnD`
- `Khaos-Krew/Nexus-Overseer`
- `Khaos-Krew/Khaos-Nexus-Diagnostics`
- `Khaos-Krew/Thora-Desktop` (preserved, paused)

### Architecture decision required before expansion
- `Khaos-Krew/Khaos-Nexus-AI`
- `Khaos-Krew/Khaos-Nexus-AI-Core`
- `Khaos-Krew/Khaos-Nexus-ARK-Bridge`

Do not create new overlapping AI runtimes until ownership is resolved.

### Pause/archive candidates
- `Khaos-Krew/nexus-idleon-companion`
- `Khaos-Krew/khaos-nexus-embed-studio`
- `Khaos-Krew/Khaos-Nexus-Palworld-Admin-Pannel`
- `Khaos-Krew/nexus-mobile-companion`
- `Khaos-Krew/Nexus3D`
- `Khaos-Krew/Nexus-Shattered-Realms`

These are not part of the rebuild critical path.

## Rebuild architecture

```text
Discord / Web / Desktop
        |
        v
Khaos-Nexus
  - Sentinel
  - Discord Hub
  - Scheduler / permissions
  - Game adapters
  - Veyra integration
  - Worker control plane
        |
        +--> Postgres
        +--> ARN
        +--> ARK dynamic config
        +--> ARK worker
        +--> General worker
        +--> Nexus-DnD
        +--> Nexus-Overseer / Forge
```

## ARK rebuild boundary

Until ARK plugin access is available, do not rebuild plugin-specific delivery paths blindly.

Keep now:
- server connection/profile configuration
- SFTP/RCON capability
- existing config backups and known-good rate/stat configuration
- ArkShop database/schema knowledge
- ARN event contract
- Shiny notification contract
- plugin inventory/probe code only where it is harmless and isolated

Defer until plugins are available:
- final ArkShop/API integration validation
- plugin command contract validation
- token/shop item delivery implementation that depends on plugin APIs
- rank/group provisioning validation
- cross-map plugin database migration
- Shiny plugin integration verification
- starter kit durability/upgradability enforcement that depends on server plugins

## Rebuild order when ARK plugins are available

1. Freeze current server saves and configuration backups.
2. Install only the minimum required ARK plugin set.
3. Validate each plugin independently before enabling Nexus automation.
4. Verify RCON/SFTP connectivity from the ARK worker.
5. Verify ArkShop database connectivity and schema without writes.
6. Enable read-only Nexus probes.
7. Enable controlled write tests on a non-critical account/item.
8. Restore shop/token/rank automation one subsystem at a time.
9. Restore ARN/Shiny notification paths.
10. Only after the above is stable, add new ARK features.

## Rules going forward

- `main` is the production target. Long-lived services must migrate away from temporary `agent/*`, `rebuild/*`, `fix/*`, and feature branches.
- No permanent Railway preview services.
- Every persistent service needs one documented owner and responsibility.
- New game support begins as a module in `Khaos-Nexus` unless isolation is technically required.
- One implementation per capability. Do not maintain duplicate bot, AI, admin, scheduler, or game-integration stacks.
- Persistent state belongs in Postgres/Supabase or an explicitly documented volume.
- Paused work gets archived or sealed instead of deployed indefinitely.
- Before deleting any repo with unique assets or code, preserve the required files in an authoritative repo first.

## Manual Railway actions still required

Railway requires account 2FA to commit the currently staged destructive changes. Apply the staged changes in the Railway dashboard for:
- Nexus-DnD preview service removals
- Thora preview removal
- KNX-BUILD-NODE-01 removal

Optional dashboard naming cleanup:
- `discerning-purpose` -> `Khaos Nexus Core`
- `strong-perception` -> `Thora Desktop`
- `just-warmth` -> `Veyra`

Do not change service domains or persistent volumes during the naming cleanup.

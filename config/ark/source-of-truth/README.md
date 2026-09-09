# Khaos Nexus ARK — Runtime Authority Contract

This directory is a **reference/config-history area**, not the live source of truth for ARK rates or settings.

## Current authority model

For the current rebuild, **Gen1 = Map1** and is the only active ARK target.

- **Runtime rates and server settings:** the live Citadel Servers `Game.ini`, `GameUserSettings.ini`, and related live server configuration are authoritative.
- **Installed/enabled mod IDs:** the live Citadel server configuration is authoritative.
- **Mod names and update metadata:** resolve the live mod IDs through the CurseForge API.
- **Git:** stores templates, sanitized snapshots, documentation, and history only. Git must not silently overwrite live Citadel settings.

Sentinel may read and compare the live server against reference files in this repository, but any future live settings write must be explicit, backed up first, diffed, and verified by readback.

Sentinel must **not** continuously reconcile or silently overwrite `Game.ini`, `GameUserSettings.ini`, rates, stats, mod lists, or map overrides from Git.

## Gen1 / Map1 workflow

1. Read the current live Citadel `GameUserSettings.ini`.
2. Read the current live Citadel `Game.ini`.
3. Read the live mod IDs from the server's actual launch/config source.
4. Resolve each mod ID through CurseForge for its canonical name and current compatible file/update metadata.
5. Present the resulting live state in Sentinel.
6. Optionally compare that live state with the non-authoritative Git reference snapshot.
7. Never auto-correct the live server to match Git.
8. If an authorized settings change is made later, back up first, show the diff, write explicitly, then read the live files back to verify the result.

## Host connectivity

The host is **Citadel Servers**. Keep the management layer provider-neutral where possible:

- use FTP/SFTP or Citadel's file-management access for live configuration files;
- use RCON for supported runtime/status/admin operations;
- keep Citadel credentials and RCON credentials in protected runtime secrets, never in Git.

Citadel's own documentation supports managing server files through FTP/SFTP or its game-panel file manager. The exact connection details for each server remain protected runtime configuration.

## Layout

```text
source-of-truth/
├─ manifest.json        # authority contract; despite the historical folder name, Git is not runtime truth
├─ policy.json          # safety/write policy
├─ cluster/
│  ├─ Game.ini          # reference snapshot only
│  ├─ GameUserSettings.ini # reference snapshot only
│  └─ rates.json        # reference snapshot only
└─ servers/
   ├─ astraeos/         # deferred until Map1 is stable
   └─ gen1/             # active Map1 profile metadata
```

## Reference files

The files under `cluster/` can be used for documentation, comparisons, rollback planning, or manually reviewed templates. They are **not deployment targets** and do not inherit automatically into Gen1.

A difference between a Git reference and the live Citadel server is not, by itself, an error. Sentinel should report the difference without changing the server.

## Mods

Do not trust a hand-maintained Git mod name as canonical. Sentinel should start with the mod IDs actually enabled on Gen1 and resolve those IDs through CurseForge.

For each live mod ID, the normalized model should eventually include at least:

- CurseForge mod/project ID;
- canonical project name;
- installed/enabled state from Citadel;
- currently observed/installed file or version when detectable;
- latest compatible CurseForge file/version;
- update available state;
- release channel and file date;
- dependency metadata where available.

CurseForge is metadata authority only; it does not decide which mods are enabled on the server.

## Secrets

This repository is public. Do **not** commit server passwords, admin passwords, RCON passwords, FTP/SFTP credentials, CurseForge API keys, Discord webhooks, tokens, or other credentials.

## Map2

Map2 is intentionally deferred. Do not clone Gen1 settings into Map2 automatically. Once Gen1 is stable, Map2 should be onboarded by reading its own live Citadel files first and then applying only deliberate shared policy.

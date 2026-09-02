# Khaos Nexus ARK — Repository Source of Truth

This directory is the authoritative configuration store for every Khaos Nexus ARK: Survival Ascended server.

## Authority model

Git is authoritative. A live ARK server is a deployment target, never the source of truth.

Sentinel must resolve a server configuration from this directory, overlay protected secrets at runtime, show the diff, back up the live files, and only write when an authorized explicit apply command is issued.

Sentinel must **not** continuously reconcile or silently overwrite Game.ini, GameUserSettings.ini, rates, stats, or map overrides.

A live server may only be captured back into Git when an owner explicitly issues a capture/import command. Captures must be sanitized, placed on a branch, and reviewed before merge.

## Layout

```text
source-of-truth/
├─ manifest.json
├─ policy.json
├─ cluster/
│  ├─ Game.ini
│  ├─ GameUserSettings.ini
│  └─ rates.json
└─ servers/
   ├─ astraeos/
   │  ├─ server.json
   │  ├─ Game.override.ini
   │  └─ GameUserSettings.override.ini
   └─ gen1/
      ├─ server.json
      ├─ Game.override.ini
      └─ GameUserSettings.override.ini
```

## Resolution order

1. `cluster/GameUserSettings.ini`
2. `cluster/Game.ini`
3. `cluster/rates.json`
4. server-specific INI overrides
5. server profile metadata
6. Sentinel protected secret overlay

The resolved configuration is what Sentinel deploys to a server.

## Cluster defaults vs overrides

Anything that should be identical across all maps belongs under `cluster/`: XP, harvest, taming, breeding, spoil timers, stat multipliers, structure rules, common gameplay settings, and other shared INI values.

Only genuine map/server differences belong under `servers/<server-id>/`: map-specific spawn overrides, map-only mod settings, identity/launch metadata, or exceptions approved for that server.

Do not duplicate cluster values into every server folder. That creates drift.

## Secrets

This repository is public. Do **not** commit server passwords, admin passwords, RCON passwords, API keys, Discord webhooks, tokens, or other credentials. Sentinel applies those from its protected runtime secret store after it builds the non-secret configuration from Git.

## New-server flow

When a server is added:

1. Create `servers/<server-id>/server.json`.
2. Add only required map/server-specific override lines.
3. Resolve the server from the cluster baseline plus overrides.
4. Validate the resulting INIs.
5. Back up the server's current files if it already exists.
6. Show the planned diff.
7. Apply only after an explicit owner/admin command.
8. Read the files back and verify they match the resolved Git revision.

This means a newly added server starts from the same canonical Khaos Nexus rates/stats/configuration instead of copying another live server.

## Bootstrap state

`manifest.json` intentionally keeps deployment disabled until the current known-good Astraeos configuration is exported and committed here. Do not guess missing rates or INI values. Once the canonical files are complete and reviewed, set `bootstrap_complete` and `deployment_enabled` to `true`.

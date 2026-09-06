# ARK desired configuration state

This directory is the Git-owned source of truth for Khaos Nexus ARK gameplay configuration.

## Authority model

- GitHub stores the intended cluster state.
- Sentinel may read this state and compare it with live servers.
- Live ARK servers are runtime targets, never a source that silently writes back to Git.
- Normal runtime processes must not automatically overwrite `Game.ini` or `GameUserSettings.ini`.
- Any future live apply must be explicit, produce a preview/diff first, create a backup, verify the final file, record a transaction, and roll back on failure.
- A config apply never automatically restarts a game server.

## Player-stat protection

Keys matching `PerLevelStatsMultiplier_Player[...]` are protected. They may be recorded in Git so the intended values are not lost, but Sentinel's ordinary profile/apply path must refuse to change them unless an owner-approved protected-setting workflow explicitly opts in.

## Current status

`cluster.json` is `preview-only` and `liveVerified=false`. Its values were migrated from the existing hard-coded Nexus ARK baseline so the current intended configuration is captured in version control. Before this manifest is enabled for live application, Gen1 and Astraeos should be compared against it and any intentional differences committed as server overrides.

This design deliberately separates **recording desired state** from **changing a running server**.

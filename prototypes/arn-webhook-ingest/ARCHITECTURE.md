# ARN Live Bounty Board Architecture

## Event path

`Shiny! Dinos -> dedicated per-map Discord webhook -> hidden #arn-ingest -> Sentinel -> parser -> classifier -> board state -> one persistent public bounty-board embed`

Genesis 1 and Astraeos each use a different Discord webhook, but both webhooks target the same hidden ingest channel. The webhook ID is the authoritative map identity.

The hidden channel is both the ingestion point and a lightweight restart journal. Sentinel replays recent webhook messages on startup to reconstruct the current board without requiring ArkAPI or ARK entity scans.

## Lifecycle normalization

Incoming Shiny messages are normalized into:

- `detected` -> `ACTIVE`
- `contained` -> `CAPTURED`
- `terminated` -> `DEFEATED`
- `lost` -> `SIGNAL LOST`

ACTIVE entries remain until a lifecycle event resolves them. CAPTURED and DEFEATED entries remain visible for a configurable grace period (default 3 minutes) before disappearing. SIGNAL LOST uses a shorter default grace period (1 minute).

## Danger classification

Initial prototype danger scale:

- Class I / WATCH: default anomaly
- Class II / ELEVATED: unusual visual/prefix variants
- Class III / SEVERE: rare prefixes such as Princess, Noir, Pygmy, Spectral, Lunar, Solar, Mythic
- Class IV: reserved for future critical classifications
- Class V / KAIJU: Enraged

Enraged/KAIJU entries display the configured Khaos Nexus reward of one Tekgram on termination.

## Board behavior

The public output is one persistent Discord message. Each accepted lifecycle event edits that message instead of posting a new public alert. The board groups anomalies by map, sorts ACTIVE entries ahead of recent resolutions, and places higher danger classes first.

If any active KAIJU threat exists, the board title switches to a KAIJU ALERT state.

## Correlation and deduplication

Discord source message IDs are used to reject duplicate processing. Shiny does not currently expose a guaranteed unique ARK creature identifier in its Discord event, so lifecycle correlation uses map + full Shiny creature name.

If multiple identical names are simultaneously active on the same map, Sentinel updates the newest matching signal and logs an ambiguity warning. This is intentionally conservative until a stronger unique-ID source is available.

## Failure behavior

The Shiny source events remain in the hidden ingest channel if Sentinel is unavailable. On restart, Sentinel replays up to `ARN_REPLAY_LIMIT` recent messages (maximum 100 in the prototype), reconstructs board state, removes already-expired resolved entries, and then refreshes the persistent board.

For a production version, the next durability step is database-backed incident state so very old active anomalies cannot fall outside Discord replay history.

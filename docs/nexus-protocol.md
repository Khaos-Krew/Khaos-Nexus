# Nexus Protocol v1

The six versioned definitions are Alpha Purge, Ascension, Dark Zone, Anomaly,
Extraction and Community. A run snapshots its definition and qualification rules.
Draft → active ↔ paused → completed/failed/cancelled. Only completed, qualified,
non-disqualified participation grants non-spendable Protocol Score.

## Current operational surface

`/protocol status`, `list`, `history`, `stats`, `leaderboard`, `join`, `progress`.
Staff additionally control `season`, `create`, `start`, `pause`, `complete`, `fail`,
`cancel`, `participants`, `record`, `disqualify`. Seasons require explicit dates;
there is no automatic reset or invented season schedule. Lifetime records remain.
The Discord draft defaults are 5 verified active minutes, one objective, 100 score,
and a 60-minute run. The engine accepts per-run thresholds and map scopes.

Create a season, create a draft scoped to registered map IDs, start it, then have
linked players join. Staff may record evidence using a stable event ID, exact ISO
timestamp, map and evidence reference. Active intervals are at most 60 seconds;
record only activity actually observed, never infer activity from online presence.
AFK, dead or spectating intervals must not be submitted as active. Completing a
run atomically awards qualified players. Failed/cancelled runs award nothing.

## Persistence and evidence contract

`/app/data/nexus-protocol-v1.json` on Railway contains a versioned/checksummed
snapshot. Local deployments use NEXUS_DATA_DIR or the repository data directory.
Every accepted mutation records actor/action/time in the same atomic transaction
as progress, receipts and awards. Transactions acquire an exclusive filesystem
lock, sync the new file, atomically replace the snapshot and sync its directory.
Corruption fails closed. Do not delete a lock unless the writer is confirmed dead.
Preserve the volume and back it up before upgrades. There is no automatic pruning;
at 64 MiB writes stop until an audited archive/migration is performed.

Event IDs must identify the original authoritative event (creature ID/death
sequence, objective delivery receipt or interval). Re-delivery reuses the same ID.
All linked ARK identities aggregate under the Discord identity. The trusted adapter
must resolve current verified links, validate the actual objective/target, ensure
map ownership and reject fabricated, AFK or reused creature events. Discord players
cannot submit evidence; staff submissions are explicitly attributed. There is no
automatic game telemetry adapter in this release and no public ingestion endpoint.
Award ledger entries are prestige records, not currency transfers or reward delivery.

## Dark Zone policy and remaining activation boundary

The policy module implements SAFE, PENDING, ENLISTED, COOLDOWN and SUSPENDED,
5-minute activation, 30-minute withdrawal and a 15-minute combat extension.
Both players must consent; unknown ownership and same-tribe combat are denied.
Solo consent never exposes tribe assets. Tribe raids require both tribes enrolled.
Individually enrolled tames require the current owner to match the consenting owner.
Tribe/tame IDs must be map-scoped and ownership must come from the game adapter.
Repeated kill pairs within an hour do not qualify. Kill validation alone awards no score.

The adapter must enforce damage denial in the game for players, structures and tames,
including projectiles, explosives, offline owners, transfers, indirect damage and
tribe membership changes. It must use stable account identities, synchronously
record combat, fail closed on stale state/unavailability, and verify consent/tribe
authority. Tests exercise the policy with an injected readiness function; production
has no adapter and cannot enlist or start Dark Zone runs. Discord cannot protect
game entities on its own. No server PvE/PvP configuration is changed.

Next integration milestones: authoritative ARK activity/objective adapters, native
damage enforcement and a tested consent confirmation flow, then PvP score ingestion.
Automatic boss spawning, rewards/currency delivery and leaderboards by tribe are
not activated by this release.

## Announcement

The banner reconciler edits message 1546061402979180698 in channel
1545126905643147264. It does not delete or send announcements. Original content and
the Ark Access mention are preserved without repinging. After Discord commands
register, Sentinel appends a truthful Nexus-themed milestone field in the same embed.

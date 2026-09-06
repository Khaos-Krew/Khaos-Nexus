# Nexus Protocol v1

The six versioned definitions are Alpha Purge, Ascension, Dark Zone, Anomaly,
Extraction and Community. A run snapshots its definition and qualification rules.
Draft → active ↔ paused → completed/failed/cancelled. Only completed, qualified,
non-disqualified participation grants non-spendable Protocol Score.

## Current operational surface

`/protocol status`, `list`, `history`, `stats`, `leaderboard`, `join`, `progress`.
Staff additionally control `season`, `create`, `start`, `pause`, `complete`, `fail`,
`cancel`, `participants`, `record`, `disqualify`, `telemetry`. Seasons require explicit dates;
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
cannot submit evidence; staff submissions are explicitly attributed. The authenticated
evidence intake is implemented, but no live game exporter is configured yet.
Award ledger entries are prestige records, not currency transfers or reward delivery.

## Authenticated game evidence intake

`POST /v1/protocol/evidence/{sourceId}` accepts one JSON event with the source's
dedicated `Authorization: Bearer` credential. Admin and Forge credentials do not
authorize this route. HTTPS is provided by the existing Railway endpoint. No sources
are enabled by default, and no secrets are returned by `/protocol telemetry`.

Configure `NEXUS_PROTOCOL_SOURCES` as a JSON array. Each source has a unique lowercase
`id`, one exact `map`, allowed `metrics`, and a `tokenEnv` naming its separate secret:

```json
[{"id":"gen1","map":"ARK_GEN1","metrics":["alpha-kill","active-seconds"],"tokenEnv":"NEXUS_PROTOCOL_SOURCE_GEN1_TOKEN"}]
```

Provision a random source token with at least 32 characters through Railway variables
only after reviewing the exporter. The source's trusted game process must supply:

```json
{"version":1,"eventId":"death-instance-123","runId":"RUN_UUID","eosId":"VERIFIED_EOS_ID","map":"ARK_GEN1","metric":"alpha-kill","amount":1,"at":1788680000000,"factId":"creature-instance-123"}
```

`at` is the original game event's Unix timestamp in milliseconds. Fresh events must
be no older than 120 seconds and never in the future. An exact already-accepted retry
may arrive later; changing any normalized evidence conflicts. Automatic objectives
support alpha kills, boss kills, anomaly kills and deliveries. Every objective needs
an authoritative `factId` identifying the creature incarnation/death or delivery
transaction. Changing `eventId` or resending through another source cannot grant the
same fact twice to a player. Facts cannot be reused across runs for that player.

Activity events use `metric: "active-seconds"`, amount 1–60, `intervalStart` in
milliseconds, and explicit `active: true`, `alive: true`, `spectating: false`.
They omit `factId`. The interval must exactly match the verified duration. Overlap,
paused time, wrong maps, missing participants, disqualification and expired runs are
rejected. Being online alone is not evidence of activity. Only verified EOS-to-Discord
links are accepted; display names and user-written chat are never identity evidence.

Requests are limited to 16 KiB, a five-second body deadline, and 120 requests per
source per minute. Credentials are checked before parsing. Responses: 200 ACCEPTED
or DUPLICATE; 401 invalid source credentials; 409 evidence conflict; 413 oversized;
415 non-JSON; 422 malformed/stale/future evidence; 429 throttled; 503 disabled or
unavailable. Invalid source configuration disables intake. Errors do not echo
credentials, player data or request bodies. Accepted receipts identify the adapter.

Production validation must first show that the exporter provides authentic IDs,
stable facts, reliable timestamps and real activity detection. Existing Shiny name
notifications and chat parsing do not meet that standard. Native damage protection
is a separate requirement; this endpoint never accepts PvP kills or changes PvP state.

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

The original banner announcement (1546061402979180698) is preserved. Completed
features are announced as separate Nexus-themed text posts in #cluster-news
(1545126905643147264), after Discord commands register successfully. The current
post announces the Core Registry and clearly marks automatic telemetry and live PvP
enforcement as unfinished. Future completed features receive their own stable IDs.
There are no automatic feature edits to the original embed and no role repings.

Each feature post reserves a durable receipt before sending, then records its
Discord message ID. Restarts do not repost published features. If a send has an
uncertain outcome, the receipt remains pending: inspect Discord and reconcile the
receipt before any retry. Do not blindly delete pending receipts.

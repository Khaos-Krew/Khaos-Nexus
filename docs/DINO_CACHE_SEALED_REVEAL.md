# Dino Cache Sealed Reveal Flow

Status: staged on `agent/ark-cache-sealed-reveal-mysql`; not deployed automatically.

## Player flow

1. Sentinel ingests a verified shop transaction from MySQL.
2. The deterministic Dino Cache RNG runs exactly once and the exact species, blueprint, Normal/X/S variant, and level are persisted.
3. The transaction enters `SEALED`. Sealed rows are not actionable by the delivery worker.
4. If the EOS account is linked to Discord, Sentinel sends a private sealed-cache DM with **Reveal Now** and **Reveal Later**. The DM contains no reward fields.
5. **Reveal Later** leaves the database row unchanged in `SEALED`.
6. `/caches` is the recovery surface for every linked account and shows unopened cache shells only.
7. **Reveal Now** atomically verifies ownership and transitions `SEALED -> REVEALED`, then renders the already-persisted reward. Reveal never calls the RNG engine.
8. The public reveal is posted to Discord Cluster Chat. AAT is responsible for mirroring that Discord message into ARK; Sentinel does not send a second RCON chat announcement.
9. Only `REVEALED` and explicitly approved `RETRY` rows are visible to the Dino Ball delivery worker.
10. Delivery remains fail-closed on ambiguous RCON acknowledgement.

## MySQL migration

For an existing Dino Cache database, apply:

`config/ark/mysql/002-nexus-dino-cache-sealed-reveal.sql`

The runtime preflight refuses to start the cache processor until the sealed-reveal columns and state enum are present.

New installations can use `config/ark/mysql/001-nexus-dino-cache.sql` directly.

## Runtime variables

Existing required variables remain unchanged:

- `ARKSHOP_DB_MODE=mysql`
- `ARKSHOP_DB_HOST`
- `ARKSHOP_DB_PORT`
- `ARKSHOP_DB_NAME`
- `ARKSHOP_DB_USER`
- `ARKSHOP_DB_PASSWORD`
- `NEXUS_ARK_DINO_CACHE_ENABLED=true`
- `NEXUS_DINO_CACHE_RNG_SECRET` (minimum 32 characters)
- `NEXUS_DINO_CACHE_SERVER_MAP_JSON`

Reveal/public-result variables:

- `NEXUS_DINO_CACHE_CLUSTER_CHAT_CHANNEL_ID` — Discord Cluster Chat channel that AAT mirrors into ARK.
- `NEXUS_DINO_CACHE_ANNOUNCE_ALL=true` — default. Every revealed cache posts its public result.
- `NEXUS_DINO_CACHE_ANNOUNCE_VARIANTS=x,s` — used only when `NEXUS_DINO_CACHE_ANNOUNCE_ALL=false`.
- `NEXUS_DINO_CACHE_ANNOUNCE_MIN_LEVEL=300` — used only when `NEXUS_DINO_CACHE_ANNOUNCE_ALL=false`.

## Safety invariants

- No Shiny outcome is introduced by this change.
- Creature pools, rarity weights, level buckets, and Normal/X/S RNG weights are not modified by this change.
- A sealed cache cannot be delivered.
- Reveal cannot reroll a reward.
- A Discord account may reveal only caches belonging to one of its linked EOS accounts.
- Duplicate shop receipts remain idempotent through the existing source transaction unique key.
- `/caches` and the private DM never expose persisted reward fields before reveal.
- AAT is the only ARK chat bridge for public reveal messages; Sentinel does not duplicate the public result through RCON.

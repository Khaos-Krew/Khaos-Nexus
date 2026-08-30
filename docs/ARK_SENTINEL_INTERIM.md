# ARK Sentinel Interim Systems

Sentinel owns the interim ARK identity, rank projection, cross-chat, spawn telemetry, reward-cache, and event foundations while Forge is incomplete. The production path uses the existing Railway Sentinel service, persistent data volume, Discord bot, RCON/Extended RCON, SFTP, and ArkShop plumbing. It does not depend on DevKit Bridge.

## Persistent, auditable state

All new journals follow `NEXUS_DATA_DIR` and therefore use the existing Railway `/app/data` volume:

- `ark-identities.json` — Nexus profiles, hashed one-time challenges, Discord-to-EOS links, projected rank, and link audit entries.
- `ark-cross-chat-audit.json` — relay outcome metadata and content hashes; raw chat content is intentionally not retained.
- `ark-spawn-monitor.json` — per-map species samples, learned normal baselines, and future approved-action records.
- `ark-reward-journal.json` and `ark-event-journal.json` — reward and event records from the existing foundations.

`NEXUS_IDENTITY_SECRET` may supply a stable random value of at least 32 characters from Railway environment storage. When it is omitted, Sentinel creates an equally strong private secret once on the existing Railway `/app/data` volume and reuses it. Rotating or deleting that secret invalidates pending link codes but does not remove verified links.

## Account linking

The `/ark link` command creates a hashed, single-use code with a ten-minute default expiry. The player enters `!link CODE` in ARK chat. Sentinel accepts the code only when the speaking player resolves uniquely to an EOS identity in the current `ListPlayers` response. An EOS identity cannot belong to two Discord profiles. `/ark link-status` and `/ark unlink` are self-service and ephemeral.

Required activation variables:

- `NEXUS_IDENTITY_SECRET` — optional stable 32+ character secret; otherwise the private volume-backed secret is used.
- `ARK_GEN1_ACCOUNT_LINKING_ENABLED=true`
- `ARK_GEN1_CHAT_POLL_COMMAND=GetChat` — change this if the installed Extended RCON provider exposes a different read-only command.
- `ARK_GEN1_CHAT_POLL_SECONDS=10` — minimum five seconds.
- `ARK_ACCOUNT_LINK_CHAT_COMMAND=!link` — player-facing command text.

Verify the exact chat response format on the test server before enabling production polling.

## Rank projection

Discord remains authoritative. Existing Server Shop role mapping or Premium App entitlement reconciliation assigns one of the configured Discord roles. Sentinel projects the highest configured role into every linked Nexus profile and the ASA Permissions plugin every 30 minutes, immediately after account linking, and on Discord member-role updates. All six ranks are supported: Shadow Recruit, Cipher Runner, Nexus Raider, Khaos Warden, Blackout Legend, and legacy Origin Founder. Origin Founder remains legacy-only and is never converted into a purchasable SKU entitlement.

Saved Sentinel role IDs are authoritative. If a rank has no saved ID, Sentinel may fall back only to an exact normalized match of that official rank name; an explicitly configured but absent role never falls through to a same-name duplicate.

Live ARK delivery uses the official Permissions RCON commands and read-back verification. Sentinel first adds the desired group, then removes only stale groups from its six-name managed allowlist. It never removes `Default`, `Admins`, or any unrelated group. `/ark rank-sync` provides an audited staff reconciliation. Self-service unlink fails closed until the managed ARK rank is verifiably revoked.

Rank activation variables:

- `ARK_GEN1_RANK_SYNC_ENABLED=true`
- `ARK_GEN1_RANK_GROUP_PROVISION_ENABLED=true` — allows creation of missing Nexus groups, but never grants wildcard/admin permissions.
- optional `ARK_GEN1_RANK_GROUPS_JSON` — JSON mapping of the six rank IDs to unique, space-free Permissions group names. Defaults are `NexusShadowRecruit`, `NexusCipherRunner`, `NexusRaider`, `NexusKhaosWarden`, `NexusBlackoutLegend`, and `NexusOriginFounder`.

## Cross-chat

Cross-chat remains part of the existing Sentinel bot. It is disabled unless all required variables are present:

- `NEXUS_ARK_CROSSCHAT_ENABLED=true`
- `NEXUS_ARK_CROSSCHAT_CHANNEL_ID=<Discord channel id>`
- `ARK_GEN1_CHAT_POLL_COMMAND=GetChat`
- `ARK_GEN1_CHAT_SEND_COMMAND=ServerChat`
- optional `NEXUS_ARK_CROSSCHAT_BLOCKED_TERMS=term one,term two`

Enabling cross-chat also requires the Discord Message Content intent in the application portal. Relays include Nexus branding and a map label, remove mass mentions/control characters, use a loop marker, suppress replayed history, enforce rate limits, call a moderation hook, and write hash-only audit entries.

## Megalodon spawn monitoring

Monitoring is read-only and disabled until the installed Extended RCON species-count command is confirmed:

- `ARK_GEN1_SPAWN_MONITOR_ENABLED=true`
- `ARK_GEN1_SPECIES_COUNT_COMMAND=<command containing {class}>`
- optional `ARK_GEN1_SPAWN_MONITOR_SECONDS=300`
- optional `ARK_GEN1_MEGALODON_BASELINE=45`
- optional `ARK_GEN1_MEGALODON_ALERT_COUNT=80`
- optional `ARK_GEN1_MEGALODON_CRITICAL_COUNT=120`
- optional `NEXUS_ARK_SPAWN_ALERT_CHANNEL_ID=<staff alert channel id>`

Sentinel learns a per-map median baseline from normal samples. Alerts include a conservative `DinoSpawnWeightMultipliers` Game.ini recommendation. The generated targeted correction plan has `autoExecute=false` and requires explicit approval. Sentinel never generates or automatically runs `DestroyWildDinos`.

## Activation order

1. Deploy code with every new runtime switch false.
2. Set and retain `NEXUS_IDENTITY_SECRET`, or verify the private volume-backed fallback was created.
3. Verify `GetChat` and the species-count command against the test server.
4. Enable account linking and complete a real Discord-to-EOS acceptance link.
5. Enable ARK rank synchronization/group provisioning and confirm linked rank delivery for a free rank, paid rank, and Origin Founder.
6. Enable cross-chat in a private test channel and verify both directions, replay suppression, rate limiting, and moderation.
7. Enable read-only Megalodon sampling; collect at least 24 normal samples before changing Game.ini.
8. Require a separate explicit approval for any targeted spawn correction or production Game.ini change.

## Supporter reward caches

Linked supporters can use `/ark supporter-cache` and `/ark supporter-cache-status` after `ARK_GEN1_SUPPORTER_CACHE_ENABLED=true`. Claims use rolling daily or weekly allowances, reserve before delivery, and are serialized per Nexus profile. Definite pre-delivery failures release the allowance; partial or ambiguous deliveries enter manual review and cannot be retried automatically.

The built-in verified adapters support Nexus Points through ArkShop `AddPoints` plus a balance read-back, and Nexus event tokens through Sentinel's persistent ledger. Kit rewards remain excluded from live rolls unless both `ARK_GEN1_REWARD_KIT_DELIVERY_ENABLED=true` and an operator-verified `ARK_GEN1_REWARD_KIT_COMMAND` containing `{eos}` and `{kit}` are configured. Profiles with multiple linked ARK identities fail closed until primary-account selection is implemented.

Every live pool is revalidated against the supporter non-P2W tags and its cache value budget before rolling. Pity protection activates after a configurable run of low-value claims but cannot exceed the same value ceiling or bypass the delivery-adapter allowlist.

## ARK event runtime

Set `ARK_GEN1_EVENT_ENGINE_ENABLED=true` only after test-server RCON broadcasts are accepted. Staff then receive `/ark event-start`, `/ark event-status`, `/ark event-progress`, `/ark event-finish`, and `/ark anomaly-propose`.

The runtime supports Nexus Supply Rush, Alpha Hunt, Nexus Anomaly Surge, Blood Moon, and Nexus Community Goal. It permits one active event per map, stores measurable objectives and bounded staff notes, closes expired windows on a one-minute timer, enforces per-event cooldowns, and prepares a non-P2W event-cache reward hook at completion. Reward hooks are not awarded automatically.

If Sentinel cannot prove an announcement completed, the event enters announcement review and the broadcast is not automatically repeated. Automatic event selection is disabled. Anomaly proposals contain a tier, species, level, and reward multiplier for staff review, but `autoSpawn` is always false and no executable spawn command is created.

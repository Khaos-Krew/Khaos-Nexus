# ARK Sentinel Interim Systems

Sentinel owns the interim ARK identity, rank projection, cross-chat, spawn telemetry, reward-cache, and event foundations while Forge is incomplete. The production path uses the existing Railway Sentinel service, persistent data volume, Discord bot, RCON/Extended RCON, SFTP, and ArkShop plumbing. It does not depend on DevKit Bridge.

## Persistent, auditable state

All new journals follow `NEXUS_DATA_DIR` and therefore use the existing Railway `/app/data` volume:

- `ark-identities.json` — Nexus profiles, hashed one-time challenges, Discord-to-EOS links, projected rank, and link audit entries.
- `ark-cross-chat-audit.json` — relay outcome metadata and content hashes; raw chat content is intentionally not retained.
- `ark-spawn-monitor.json` — per-map species samples, learned normal baselines, and future approved-action records.
- `ark-reward-journal.json` and `ark-event-journal.json` — reward and event records from the existing foundations.

`NEXUS_IDENTITY_SECRET` must be a stable random value of at least 32 characters stored only in Railway environment storage. Rotating it invalidates pending link codes but does not remove verified links.

## Account linking

The `/ark link` command creates a hashed, single-use code with a ten-minute default expiry. The player enters `!link CODE` in ARK chat. Sentinel accepts the code only when the speaking player resolves uniquely to an EOS identity in the current `ListPlayers` response. An EOS identity cannot belong to two Discord profiles. `/ark link-status` and `/ark unlink` are self-service and ephemeral.

Required activation variables:

- `NEXUS_IDENTITY_SECRET` — stable 32+ character secret.
- `ARK_GEN1_ACCOUNT_LINKING_ENABLED=true`
- `ARK_GEN1_CHAT_POLL_COMMAND=GetChat` — change this if the installed Extended RCON provider exposes a different read-only command.
- `ARK_GEN1_CHAT_POLL_SECONDS=10` — minimum five seconds.
- `ARK_ACCOUNT_LINK_CHAT_COMMAND=!link` — player-facing command text.

Verify the exact chat response format on the test server before enabling production polling.

## Rank projection

Discord remains authoritative. Existing Server Shop role mapping or Premium App entitlement reconciliation assigns one of the configured Discord roles. Sentinel projects the highest configured role into every linked Nexus profile every 30 minutes and on Discord member-role updates. All six ranks are supported: Shadow Recruit, Cipher Runner, Nexus Raider, Khaos Warden, Blackout Legend, and legacy Origin Founder. Origin Founder remains legacy-only and is never converted into a purchasable SKU entitlement.

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
2. Set and retain `NEXUS_IDENTITY_SECRET`.
3. Verify `GetChat` and the species-count command against the test server.
4. Enable account linking and complete a real Discord-to-EOS acceptance link.
5. Confirm linked rank projection for a free rank, paid rank, and Origin Founder.
6. Enable cross-chat in a private test channel and verify both directions, replay suppression, rate limiting, and moderation.
7. Enable read-only Megalodon sampling; collect at least 24 normal samples before changing Game.ini.
8. Require a separate explicit approval for any targeted spawn correction or production Game.ini change.

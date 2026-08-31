# Shiny! Dinos and Nexus Anomaly operations

## Authority and verified interface

The integration targets **Shiny! Dinos Ascended**, CurseForge project **928548**. The mod's official configuration page documents `[Shiny]` settings in `GameUserSettings.ini`, while its Discord page documents `[ShinyDiscord]`, the webhook URL, lifecycle patterns, and replacement tokens. The developer page documents in-game buffs and Blueprint access, but no supported external server event API. Sentinel therefore uses the documented Discord webhook interface and does not add a DevKit bridge.

- [Official Shiny! Dinos Ascended project](https://www.curseforge.com/ark-survival-ascended/mods/shiny-ascended)
- [Official configuration reference, revision 61](https://legacy.curseforge.com/ark-survival-ascended/mods/shiny-ascended/pages/shiny-ascended/configuration)
- [Official Discord notification reference, revision 36](https://legacy.curseforge.com/ark-survival-ascended/mods/shiny-ascended/pages/shiny-ascended/discord-notification-configuration)
- [Official mod-developer information](https://legacy.curseforge.com/ark-survival-ascended/mods/shiny-ascended/pages/shiny-ascended/information-for-mod-developers)

## Balanced Khaos preset

`config/ark/shiny/shiny-nexus-balanced.ini` is a staged template, not an automatic live mutation. It targets four active wild Shinies per map (within the requested 3–5 range), slows replenishment to 60–120 minutes, keeps lifetimes at 8–12 hours, lowers special/enraged/subvariant/stat-boost frequency, and removes automatic Tek unlock progression. Notifications and tracker information omit exact coordinates.

The template deliberately includes a placeholder webhook URL. Replace it only after the HTTPS Sentinel endpoint, strong ingest token, shared MySQL schema, and one staging webhook have passed validation. The mod requires its configuration to be placed under the exact documented INI sections. Applying the mod or its startup configuration requires a controlled server restart; this change does not perform one.

## Lifecycle and announcements

The configured webhook patterns send a bounded marker to Sentinel:

`NEXUS|STATE|DINO|REGION_OR_PLAYER|SERVER|MAP`

Sentinel records `ACTIVE`, `TAMED`, `KILLED`, and `DESPAWNED` events in shared MySQL. `FAILED` is reserved for internal processing failure and `UNKNOWN` is used when a terminal event cannot be matched uniquely. Duplicate webhook payloads are rejected by a unique fingerprint. `NoActiveDuplicateDinos=True` makes map-and-dino lifecycle matching practical; Sentinel still fails to `UNKNOWN` instead of guessing if more than one active match exists.

Discord output goes to `#nexus-anomalies`. Optional ARK cross-chat relay is wired behind `NEXUS_SHINY_CROSSCHAT_ENABLED=true`. Neither output includes coordinates. Automatic anomaly spawning is absent; the three preset tiers are configuration architecture only and all require explicit approval.

## Activation gates

Keep all of these false until their prerequisite is proven:

- `NEXUS_SHINY_CHANNEL_ENABLED`: creates/reuses `#nexus-anomalies`; safe to enable without restarting ARK.
- `NEXUS_SHINY_INGEST_ENABLED`: accepts authenticated mod webhook events; requires migration 002 and shared MySQL.
- `NEXUS_SHINY_CROSSCHAT_ENABLED`: relays lifecycle messages through Sentinel-owned RCON; enable only after a staging event proves the server-chat command and rate behavior.
- `NEXUS_ANOMALY_SCHEMA_READY`: capability-attestation flag set only after migration 002 is verified.

`NEXUS_SHINY_INGEST_TOKEN` must be at least 32 characters. The Shiny webhook URL should end in `/v1/ark/shiny-events/<token>`. Do not place that URL or token in Forge.

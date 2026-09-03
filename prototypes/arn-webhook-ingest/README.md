# ARN Webhook Ingest Prototype

Test-only Nexus Sentinel prototype for turning Shiny! Dinos Discord webhook events into a persistent live ARN bounty board.

## Flow

`Gen1 Shiny webhook -> hidden #arn-ingest -> Sentinel -> parser/classifier -> live bounty board`

`Astraeos Shiny webhook -> hidden #arn-ingest -> Sentinel -> parser/classifier -> live bounty board`

Each ARK map gets its own Discord webhook, but every webhook posts into the same private ingest channel. Sentinel uses the webhook ID as the authoritative map identity and updates one persistent public board instead of posting a new alert for every event.

The hidden ingest channel doubles as a short-term event journal. On restart, the prototype replays recent webhook messages to reconstruct current board state.

The prototype does not modify Shiny, scan ARK entities, or require ArkAPI.

## Classification source of truth

ARN trait detection is based on the official Shiny! Dinos Ascended Special Abilities & Attributes reference:

https://legacy.curseforge.com/ark-survival-ascended/mods/shiny-ascended/pages/shiny-ascended/shiny-abilities

Names not present in the documented ability list are treated as color-set/chromatic names rather than assumed rarity. The ARN danger class reflects the extra hazard introduced by the Shiny trait; it does not replace the normal threat of the underlying ARK species.

Threat scale:

- Class I / WATCH: chromatic and utility traits
- Class II / ELEVATED: movement, stealth, stat and unusual-physics traits
- Class III / SEVERE: defensive/status abilities
- Class IV / CRITICAL: direct combat and area-hazard abilities
- Class V / KAIJU: Enraged only

## Live bounty board behavior

- DETECTED -> adds an ACTIVE anomaly to the board.
- CONTAINED -> changes the matching anomaly to CAPTURED, keeps it visible briefly, then removes it.
- TERMINATED -> changes the matching anomaly to DEFEATED, keeps it visible briefly, then removes it.
- SIGNAL LOST -> changes the matching anomaly to SIGNAL LOST, then removes it on a shorter timer.
- Enraged -> KAIJU-level threat and displays the configured 1 Tekgram termination reward.
- One accepted Shiny source event edits the existing board; it does not create public channel spam.

## Features

- requires dedicated Shiny webhook-to-map mappings;
- accepts webhook-authored messages only from the configured private ingest channel;
- ignores unregistered webhook IDs;
- uses each map's webhook ID as the authoritative server/map source;
- warns if Shiny payload/footer map text disagrees with the webhook mapping;
- parses detected, signal-lost, contained, and terminated lifecycle events;
- maintains in-memory active/resolved anomaly state;
- reconstructs state by replaying recent hidden-ingest messages after restart;
- classifies documented Shiny abilities using the official ability reference;
- labels unmatched names as Chromatic/WATCH rather than inventing rarity;
- treats Enraged as Class V / KAIJU and displays the 1 Tekgram termination reward;
- shows the recognized Shiny trait on bounty-board entries;
- retains CAPTURED/DEFEATED status for a configurable period before clearing;
- uses a shorter configurable retention period for SIGNAL LOST;
- discovers an existing ARN board message or creates one if none exists;
- supports `ARN_DRY_RUN=true` so parsing/state changes can be verified without posting publicly;
- supports a JSON webhook map for adding future cluster maps without changing code;
- includes parser, classifier, and board-state tests.

## Current prototype limitation

Shiny Discord events do not provide a guaranteed unique ARK creature identifier. Lifecycle events are correlated using map + full Shiny creature name. If two identical active Shiny names exist on the same map, Sentinel updates the newest matching signal and logs the ambiguity. Persistent database-backed identity can be added later if a stronger data source becomes available.

## Run

```bash
cd prototypes/arn-webhook-ingest
npm install
node --test
npm start
```

Copy `.env.example` into your runtime environment. Keep Discord bot tokens and webhook URLs in Railway/environment variables; never commit them.

See `TESTING.md` for the staged Discord test and rollback procedure.

# ARN Webhook Ingest Prototype

Test-only Nexus Sentinel prototype for turning Shiny! Dinos Discord webhook events into a persistent live ARN bounty board.

## Flow

`Gen1 Shiny -> ARN - Genesis 1 webhook -> hidden #arn-ingest -> Sentinel -> parser/classifier -> live bounty board`

`Astraeos Shiny -> ARN - Astraeos webhook -> hidden #arn-ingest -> Sentinel -> parser/classifier -> live bounty board`

Each ARK map gets its own incoming Discord webhook in the same private intake channel. Use the naming convention `ARN - [mapname]`. Sentinel can enumerate those webhook objects, learn their IDs from their names, and then uses the webhook ID as the authoritative runtime map identity. Webhook URLs and tokens are never stored in the repo or printed by the prototype.

The hidden ingest channel doubles as a short-term event journal. On restart, the prototype replays recent webhook messages to reconstruct current board state.

The prototype does not modify Shiny, scan ARK entities, or require ArkAPI.

## Prepare the hidden intake channel

The prototype includes an idempotent one-shot provisioner. It creates or reuses `#arn-ingest` under the existing hidden category, inherits the category permission model, explicitly hides the channel from `@everyone`, and grants Sentinel the channel permissions needed to read messages and enumerate incoming webhook metadata.

Set `DISCORD_GUILD_ID` plus either `ARN_HIDDEN_CATEGORY_ID` (preferred) or `ARN_HIDDEN_CATEGORY_NAME`, then run:

```bash
npm run setup:intake
```

The provisioner prints the resulting channel ID. Put that value in `ARN_INGEST_CHANNEL_ID`.

Afterward, create one incoming webhook in `#arn-ingest` per ARK map using names such as:

- `ARN - Genesis 1`
- `ARN - Astraeos`

With `ARN_AUTO_DISCOVER_WEBHOOKS=true`, Sentinel discovers those named webhook objects on startup. If a new correctly named webhook is added while Sentinel is already running, an otherwise unknown webhook message triggers one metadata refresh and retry. Explicit ID mappings in Railway remain supported and take precedence if a webhook name disagrees with a pinned map.

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
- Entries explicitly display `Threat Level - [level]`.
- One accepted Shiny source event edits the existing board; it does not create public channel spam.

## Features

- dedicated Shiny webhook per ARK map;
- `ARN - [mapname]` webhook-name discovery with webhook ID as the trusted runtime identity;
- accepts webhook-authored messages only from the configured private ingest channel;
- ignores unregistered/non-ARN webhook IDs after discovery;
- warns if a pinned webhook ID disagrees with its `ARN - [mapname]` name;
- warns if Shiny payload/footer map text disagrees with the webhook mapping;
- parses detected, signal-lost, contained, and terminated lifecycle events;
- maintains in-memory active/resolved anomaly state;
- reconstructs state by replaying recent hidden-ingest messages after restart;
- classifies documented Shiny abilities using the official ability reference;
- labels unmatched names as Chromatic/WATCH rather than inventing rarity;
- treats Enraged as Class V / KAIJU and displays the 1 Tekgram termination reward;
- retains CAPTURED/DEFEATED status for a configurable period before clearing;
- uses a shorter configurable retention period for SIGNAL LOST;
- discovers an existing ARN board message or creates one if none exists;
- supports `ARN_DRY_RUN=true` so parsing/state changes can be verified without posting publicly;
- supports explicit JSON webhook mapping for future maps if automatic discovery is disabled;
- includes parser, classifier, board-state, and webhook-routing tests.

## Current prototype limitation

Shiny Discord events do not provide a guaranteed unique ARK creature identifier. Lifecycle events are correlated using map + full Shiny creature name. If two identical active Shiny names exist on the same map, Sentinel updates the newest matching signal and logs the ambiguity. Persistent database-backed identity can be added later if a stronger data source becomes available.

## Run

```bash
cd prototypes/arn-webhook-ingest
npm install
npm test
npm run setup:intake
npm start
```

Keep Discord bot tokens and webhook URLs in Railway/environment variables; never commit them.

See `TESTING.md` for the staged Discord test and rollback procedure.

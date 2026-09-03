# ARN Live Bounty Board Architecture

## Event path

`Shiny! Dinos -> dedicated ARN - [mapname] Discord webhook -> hidden #arn-ingest -> Sentinel -> parser -> classifier -> board state -> one persistent public bounty-board embed`

Genesis 1 and Astraeos each use a different incoming Discord webhook, but both webhooks target the same hidden ingest channel. Webhooks are named `ARN - [mapname]`, for example `ARN - Genesis 1` and `ARN - Astraeos`.

Sentinel may enumerate webhook metadata from the hidden intake channel and derive the map name from that naming convention. Once learned, the Discord webhook ID becomes the authoritative runtime map identity. Explicit ID mappings remain supported and take precedence if a webhook name disagrees with a pinned mapping. Webhook URLs/tokens are never required for routing and are not logged.

The prototype includes an idempotent `npm run setup:intake` provisioner that creates or reuses `#arn-ingest` under the configured existing hidden category. It starts from the category permission model, explicitly denies `@everyone` visibility, and grants Sentinel the channel access needed to read history and enumerate webhook metadata.

The hidden channel is both the ingestion point and a lightweight restart journal. Sentinel replays recent webhook messages on startup to reconstruct the current board without requiring ArkAPI or ARK entity scans.

## Lifecycle normalization

Incoming Shiny messages are normalized into:

- `detected` -> `ACTIVE`
- `contained` -> `CAPTURED`
- `terminated` -> `DEFEATED`
- `lost` -> `SIGNAL LOST`

ACTIVE entries remain until a lifecycle event resolves them. CAPTURED and DEFEATED entries remain visible for a configurable grace period (default 3 minutes) before disappearing. SIGNAL LOST uses a shorter default grace period (1 minute).

## Danger classification

Classification is based on the official Shiny! Dinos Ascended **Special Abilities & Attributes of Shiny Dinos** reference:

https://legacy.curseforge.com/ark-survival-ascended/mods/shiny-ascended/pages/shiny-ascended/shiny-abilities

The ARN class describes danger added by the Shiny trait. It is not intended to replace the normal danger of the underlying species. A WATCH-class chromatic Giganotosaurus is still a Giganotosaurus.

Current ARN ability-threat scale:

- **Class I / WATCH**: color-set-only names and utility traits such as Fathomless, Holographic and Shiny Tiny support traits.
- **Class II / ELEVATED**: movement, stealth, level/stat or unusual-physics traits such as Shinobi, Endurant, Spectral, Lunar, Filthy, Pygmy, Hardy, Stalwart, Inspired, Satiate, Hefty and Fierce.
- **Class III / SEVERE**: defensive/status traits that materially change an engagement: Frozen, Skeletal, Rubber, Psychotropic, Dazzling and Nightmare.
- **Class IV / CRITICAL**: direct combat/area hazard traits: Radioactive, Burning, Taser, Crystalline and Colossal.
- **Class V / KAIJU**: Enraged only.

Enraged/KAIJU entries display the configured Khaos Nexus reward of one Tekgram on termination. Public entries use the explicit wording `Threat Level - [level]`.

The official reference states that Shiny includes more than 40 color sets and that a name not listed as an ability is likely just coloring. ARN therefore does not interpret names such as Princess, Noir, Xanthic or Azure as danger/rarity by themselves. They remain visible in the full creature name but default to WATCH unless a documented ability is also present.

## Board behavior

The public output is one persistent Discord message. Each accepted lifecycle event edits that message instead of posting a new public alert. The board groups anomalies by map, sorts ACTIVE entries ahead of recent resolutions, and places higher danger classes first.

Each entry shows the matched Shiny trait. If no documented ability matches, Sentinel labels the trait `Chromatic`.

If any active KAIJU threat exists, the board title switches to a KAIJU ALERT state.

## Correlation and deduplication

Discord source message IDs are used to reject duplicate processing. Shiny does not currently expose a guaranteed unique ARK creature identifier in its Discord event, so lifecycle correlation uses map + full Shiny creature name.

If multiple identical names are simultaneously active on the same map, Sentinel updates the newest matching signal and logs an ambiguity warning. This is intentionally conservative until a stronger unique-ID source is available.

## Failure behavior

The Shiny source events remain in the hidden ingest channel if Sentinel is unavailable. On restart, Sentinel first refreshes the `ARN - [mapname]` webhook-ID map, then replays up to `ARN_REPLAY_LIMIT` recent messages (maximum 100 in the prototype), reconstructs board state, removes already-expired resolved entries, and refreshes the persistent board.

If a correctly named webhook is added while Sentinel is online, the first otherwise-unknown event causes one webhook-metadata refresh and retry. The newly learned webhook ID then remains authoritative for the process lifetime.

For a production version, the next durability step is database-backed incident state so very old active anomalies cannot fall outside Discord replay history.

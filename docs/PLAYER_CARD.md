# Player card

Phase 1 player cards live in Sentinal (`src/sentinel/card/`). The feature stays off until `CARD_ENABLED` is turned on. Do not enable it from a deploy or a Railway variable change unless that rollout is intentional.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `CARD_ENABLED` | off | Turns `/card` and View Card on. Accepted true values are `1`, `true`, `yes`, and `on`. Anything else, including an unset variable, leaves the feature off. Commands are not registered while it is off. |
| `CARD_DATA_DIR` | `<NEXUS_DATA_DIR>/card`, or `<repo>/data/card` when `NEXUS_DATA_DIR` is unset | Directory for `cards.json` and the `audit/` JSON-lines log. Set this when card files should not sit next to other Sentinal data. The directory must be writable when the flag is on. If setup cannot create it, Sentinal logs a warning, leaves the card feature off, and still logs in. |
| `CARD_LINK_RATE` | `5/600s` | Burst limit for link and unlink. The form is `count/seconds`, so `5/600s` is 5 actions in 600 seconds. A blank or invalid value uses `5/600s`. |
| `CARD_VIEW_COOLDOWN_S` | `5` | Seconds a player waits between card views. A negative or non-numeric value uses 5. |
| `CARD_SOURCE_TIMEOUT_MS` | `1500` | How long a card waits on each data source, in milliseconds, before that field is unavailable. A value below 1 uses 1500. |

`NEXUS_DATA_DIR` is the existing Sentinal data directory (image default `/app/data` on Railway). `CARD_DATA_DIR` overrides only the card subdirectory.

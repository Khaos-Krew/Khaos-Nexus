# Player card

Phase 1 player cards live in Sentinal (`src/sentinel/card/`). The feature stays off until `CARD_ENABLED` is turned on. Do not enable it from a deploy or a Railway variable change unless that rollout is intentional.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `CARD_ENABLED` | off | Turns `/card` and View Card on. Accepted true values are `1`, `true`, `yes`, and `on`. Anything else, including an unset variable, leaves the feature off. Commands are not registered while it is off. |
| `CARD_DATA_DIR` | `<NEXUS_DATA_DIR>/card`, or `<repo>/data/card` when `NEXUS_DATA_DIR` is unset | Directory for `cards.json` and the `audit/` JSON-lines log. Set this when card files should not sit next to other Sentinal data. The directory must be writable when the flag is on. If setup cannot create it, Sentinal logs a warning, leaves the card feature off, and still logs in. |

`NEXUS_DATA_DIR` is the existing Sentinal data directory (image default `/app/data` on Railway). `CARD_DATA_DIR` overrides only the card subdirectory.

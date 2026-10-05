# Player card

Phase 1 player cards live in Sentinal (`src/sentinel/card/`). The feature stays off until `CARD_ENABLED` is turned on. Do not enable it from a deploy or a Railway variable change unless that rollout is intentional.

## Environment

| Variable | Default | Purpose |
|---|---|---|
| `CARD_ENABLED` | off | Turns `/card` and View Card on. Accepted true values are `1`, `true`, `yes`, and `on`. Anything else, including an unset variable, leaves the feature off. Commands are not registered while it is off. |
| `CARD_IMAGE_ENABLED` | off | When on, `/card show`, View Card, and Share post a PNG card. Accepted true values are `1`, `true`, `yes`, and `on`. When off, or when the render fails or times out, Sentinal posts the phase 1 embed instead. |
| `CARD_DATA_DIR` | `<NEXUS_DATA_DIR>/card`, or `<repo>/data/card` when `NEXUS_DATA_DIR` is unset | Directory for `cards.json` and the `audit/` JSON-lines log. Set this when card files should not sit next to other Sentinal data. The directory must be writable when the flag is on. If setup cannot create it, Sentinal logs a warning, leaves the card feature off, and still logs in. |
| `CARD_LINK_RATE` | `5/600s` | Burst limit for link and unlink. The form is `count/seconds`, so `5/600s` is 5 actions in 600 seconds. A blank or invalid value uses `5/600s`. |
| `CARD_VIEW_COOLDOWN_S` | `5` | Seconds a player waits between card views. A negative or non-numeric value uses 5. |
| `CARD_SOURCE_TIMEOUT_MS` | `1500` | How long a card waits on each data source, in milliseconds, before that field is unavailable. A value below 1 uses 1500. |
| `CARD_FIND_ENABLED` | off | Turns on `/card find` and `/card admin find`. Requires `CARD_ENABLED` as well. Accepted true values are `1`, `true`, `yes`, and `on`. While this is off, tag lookup is not registered and the in-memory tag index is not built. |
| `CARD_FIND_ALERT_CHANNEL_ID` | unset | Optional channel that receives one message when a guild hits 300 tag lookups in an hour. The alert does not include the query or any player. |
| `CARD_FIND_ORDER_SECRET` | unset | HMAC-SHA256 key for claimant order. The same requester, folded query, and UTC date always yield the same five names. Required in production before `CARD_FIND_ENABLED=true`. If it is unset and more than five members match, the search returns the same reply as a miss and shows no names. |
| `CARD_RESTRICTED_ROLE_IDS` | unset | Comma-separated role IDs. Members with one of these roles get the same reply as a miss. Required in production before `CARD_FIND_ENABLED=true`. |
| `CARD_QUARANTINE_ROLE_IDS` | unset | Comma-separated quarantine role IDs, treated the same as restricted roles. Required in production before `CARD_FIND_ENABLED=true`. |

`NEXUS_DATA_DIR` is the existing Sentinal data directory (image default `/app/data` on Railway). `CARD_DATA_DIR` overrides only the card subdirectory.

The same restricted and quarantine role IDs can be set on the Discord config as `cardRestrictedRoleIds`, `cardQuarantineRoleIds`, or `quarantineRoleId`. `cardFindAlertChannelId` is the config form of the alert channel.

## Tag lookup

Lookup is opt-in. `findable` defaults to false, including for cards saved before lookup existed. A hidden card is never returned to members. `/card privacy findable:True` turns it on, and the link confirmation offers the same choice when lookup is enabled. Turning it off takes effect on the next search.

`/card find tag:` matches the folded tag exactly across game names and platform tags. In the name, the confusable map applies and `1` or `|` becomes `l`. Every other digit stays a digit, and leetspeak is not applied. The `#` suffix is only lowercased, so it is never folded: `Ada#1` stays `#1` and `#1234` stays `#1234`. Battle.net, Diablo IV, Destiny 2, Riot, and Xbox tags can also be searched without the `#` suffix. Each search returns at most five members. With `CARD_FIND_ORDER_SECRET` set, those five are the first claimants after an HMAC-SHA256 sort of the requester, the folded query, and the UTC date, so the same person gets the same five for that query all day. If that secret is unset and more than five members match, the search returns the same reply as a miss and shows no names. The reply is ephemeral, does not ping, and does not include coin balances.

The searcher must have been in the guild for 7 days, must not be timed out, and must not hold a restricted or quarantine role. A miss, a hidden card, a member who opted out, a rate limit, and an ineligible searcher all get the same reply: "No findable member with that tag."

Limits are 10 lookups per 10 minutes, 30 per 24 hours, a 15-minute cooldown after 5 misses in a row, and 300 lookups per hour for the whole guild. The guild limit fails closed and alerts staff once when it trips.

`/card admin find` is the only way to see a hidden or non-findable card. It requires a staff Admin (Discord Administrator, the staff admin role in `NEXUS_STAFF_ADMIN_ROLE_IDS`, or a configured admin user), a reason of 3 to 200 characters, and it is audited for 365 days, including denied attempts. Staff must not repost those results. Member lookup rows keep the folded query and result IDs for 30 days, then only counts remain.

## Card image rollback

`CARD_IMAGE_ENABLED` stays off until it is turned on deliberately. Turn the PNG card off by unsetting `CARD_IMAGE_ENABLED` (or setting it to anything other than a true value) and restarting Sentinal. `/card` keeps posting the embed. No card data is migrated. This change does not set Railway variables.

The PNG renderer uses the prebuilt `@napi-rs/canvas` package. `Dockerfile.sentinal` stays on `node:22-slim` and does not install system canvas libraries. `npm ci` fetches the Linux x64 GNU binary. The two OFL font files live in `src/sentinel/card/fonts` and are copied with `src`.

## Rollback

Turn lookup off by unsetting `CARD_FIND_ENABLED` (or setting it to anything other than a true value) and restarting Sentinal. `/card` keeps working. The find commands are not registered on that boot, and the tag index is not built. Stored `findable` values can stay in `cards.json`; they are ignored while lookup is off. No data migration is required to roll back. To remove the feature code, revert this change and restart. Do not turn `CARD_ENABLED` off unless the whole player card should go offline too.

## Birthdays

Birthday commands and the morning pass stay off until `BIRTHDAY_ENABLED` is turned on. `CARD_ENABLED` must be on as well. `NEXUS_ECONOMY_SYSTEM_GRANTS_ENABLED` stays off until an owner turns system grants on. None of these flags are set by this change.

| Variable | Default | Purpose |
|---|---|---|
| `BIRTHDAY_ENABLED` | off | Turns on `/card birthday` and the scheduler. Requires `CARD_ENABLED`. |
| `NEXUS_ECONOMY_SYSTEM_GRANTS_ENABLED` | off | Allows only `community-level-up` and `birthday-gift` Coin credits. It does not change `NEXUS_ECONOMY_WRITES_ENABLED`. |
| `BIRTHDAY_COINS_MIN` | unset | Lowest Coin in the uniform whole-number roll. Owner lock: `75`. `__PENDING_LEDGER__` counts as unset. |
| `BIRTHDAY_COINS_MAX` | unset | Highest Coin in that roll. Owner lock: `125`. |
| `BIRTHDAY_GIFT_CEILING` | unset | Per-grant ceiling for `birthday-gift`. Owner lock: `150`. A grant above it is refused. |
| `BIRTHDAY_GIFT_DAILY_CAP` | unset | Global birthday Coin cap per UTC day. Owner lock: `1500`. Overflow waits until the next UTC day and alerts staff. It is not discarded. |
| `BIRTHDAY_CHANNEL_ID` | unset | Optional channel used only when a private message fails and the member set visibility to shown or announce to true. |
| `BIRTHDAY_STAFF_ALERT_CHANNEL_ID` | unset | Staff channel for a daily-cap deferral. The alert has no birthday date. |

The scheduler does not start while any of the four Coin settings is unset or still `__PENDING_LEDGER__`. It does not invent an amount. Once those values are set, the roll is a whole number from min through max, stable for the same economic identity and gift year. The pass runs on Sentinal ready and then every hour. Delivery is 09:00 in the member's timezone, with catch-up later that day. The first present waits 14 days. A change is locked for 60 days, and the next present waits 30 days after a change. A sealed present can be revealed for 7 days. One present per calendar year in the member's timezone.

A member must have been in the guild for 7 days, the Discord account must be at least 30 days old, and the account must not be a bot, timed out, or holding a restricted or quarantine role. The date, year, and age are not posted. Audit rows do not store the month, day, or timezone. The birthday stays hidden unless the member opts in.

Coins use the same identity rules as community level-up: a verified or unmarked restricted identity can receive them, and an account hold is skipped. The ledger key is `birthday-gift:<economicIdentityId>:<giftYear>`. The request key is `birthday-gift:<discordUserId>:<giftYear>` and must match that Discord user. Two linked Discord accounts share one grant per year. The legacy JSON wallet cannot turn the grant into Nexus Points. No ArkShop grant is used.

### Rollback

Leave `BIRTHDAY_ENABLED` and `NEXUS_ECONOMY_SYSTEM_GRANTS_ENABLED` unset and restart Sentinal and the economy worker. `/card` stays as it was. Stored birthdays can remain in `cards.json`; they are ignored while the birthday flag is off. No data migration is required.

Do not enable birthdays until the Coin settings above are set to the owner-locked amounts, warden items W-B1 and W-B2 are closed, and an owner turns on the system-grant gate. `NEXUS_ECONOMY_WRITES_ENABLED` is a separate gate and is not flipped here.

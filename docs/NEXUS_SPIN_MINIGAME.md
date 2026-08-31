# Nexus Spin — Discord ARK Reward Minigame

Nexus Spin is a Sentinel-owned Discord minigame for linked ARK players. It is intentionally free-to-play and cooldown-based; players do not spend Nexus Points to spin.

## Player flow

1. Player runs `/nexusspin play`.
2. Sentinel requires a verified `Discord ID -> EOS ID` row in `ark_account_links`.
3. Sentinel rolls the reward in memory, freezes a unique Spin ID, and atomically persists the reward together with the cooldown claim.
4. Sentinel performs the payout or records a durable pending payout.
5. Discord receives a public slot-style reveal. The private interaction response contains the immutable Spin ID.
6. A player with queued rewards can run `/nexusspin claim` while online in ARK.

Unlinked players cannot play. Cooldown enforcement is keyed by EOS ID so changing Discord accounts does not create extra spins for the same linked ARK identity.

## Default economy

Default cooldown: **24 hours**.

The table contains exactly **10,000 weighted tickets** per spin. The jackpot is **25 / 10,000 = 0.25% (1 in 400)**.

| Reward | Weight | Chance |
| --- | ---: | ---: |
| 25 Nexus Points | 2,025 | 20.25% |
| 50 Nexus Points | 1,400 | 14.00% |
| 100 Nexus Points | 700 | 7.00% |
| 250 Nexus Points | 200 | 2.00% |
| 1,000 Stone | 1,200 | 12.00% |
| 1,000 Wood | 1,000 | 10.00% |
| 1,500 Fiber | 700 | 7.00% |
| 500 Metal Ingots | 800 | 8.00% |
| 500 Cementing Paste | 600 | 6.00% |
| 500 Crystal | 400 | 4.00% |
| 250 Polymer | 350 | 3.50% |
| 250 Electronics | 300 | 3.00% |
| 200 Black Pearls | 200 | 2.00% |
| 25 Element | 100 | 1.00% |
| **Dino Cache Token jackpot** | **25** | **0.25%** |

The Cache Token is a virtual entitlement in `ark_cache_tokens`. Winning it does **not** immediately roll or spawn a dinosaur. Cache redemption remains a separate Sentinel/cache workflow so the fixed Dino Cache reward can be persisted before delivery.

## Reward safety

### Nexus Points

Sentinel uses the existing ArkShop RCON gateway and verifies the balance before and after `ChangePoints`. If the credit cannot be confirmed, the reward becomes `PENDING_POINTS` instead of being discarded or blindly retried.

### Resources

Resource payout is disabled by default until the production ARK command syntax and success acknowledgement are verified. A resource roll is stored as `PENDING_RESOURCE`; `/nexusspin claim` can retry when the linked EOS player is online.

The configured command template must contain all four placeholders:

- `{eosId}`
- `{resourceKey}`
- `{amount}`
- `{spinId}`

If RCON accepts a command but Sentinel cannot match the configured success acknowledgement, the spin becomes `DELIVERY_UNKNOWN`. Automatic resend is forbidden to prevent duplication.

### Cache Token

Each jackpot inserts one unique `ark_cache_tokens` row keyed back to `source_spin_id`. The database uniqueness constraint prevents the same spin from minting multiple tokens.

## Runtime configuration

The bot remains disabled by default.

- `NEXUS_SPIN_ENABLED=true`
- `NEXUS_SPIN_COOLDOWN_SECONDS=86400`
- `NEXUS_SPIN_CHANNEL_ID=<discord channel id>` (optional; blank allows any channel)
- `NEXUS_SPIN_RESOURCE_DELIVERY_ENABLED=true`
- `NEXUS_SPIN_RESOURCE_COMMAND_TEMPLATE=<verified RCON command template>`
- `NEXUS_SPIN_RESOURCE_SUCCESS_PATTERN=<verified acknowledgement text/regex>`
- `NEXUS_SPIN_RESOURCE_ELIGIBLE_MAPS=map1,map2`

The Sentinel bootstrap may also supply `config.nexusSpin`; runtime values override packaged defaults.

## Database migration

Apply `supabase/migrations/20260831234500_nexus_spin_minigame.sql` before enabling. It creates/extends:

- `ark_account_links`
- `nexus_spin_cooldowns`
- `nexus_spin_attempts`
- `ark_cache_tokens`
- atomic `create_nexus_spin_attempt(...)`
- atomic `lock_nexus_spin_reward(...)`

The tables use RLS and the RPCs are executable only by the Supabase service role.

## Activation checklist

1. Apply the migration.
2. Populate and verify the canonical Discord/EOS link records.
3. Confirm ArkShop point reads/credits on the test server.
4. Verify the exact ARK resource-delivery command and success response before enabling resource delivery.
5. Set the Discord channel if the game should live in one dedicated channel.
6. Enable `NEXUS_SPIN_ENABLED`.
7. Test one linked account through points, queued resource, resource claim, cooldown denial, and Cache Token test injection before production odds are used.

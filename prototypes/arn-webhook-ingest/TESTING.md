# ARN Prototype Test Plan

1. Set `DISCORD_GUILD_ID` and either `ARN_HIDDEN_CATEGORY_ID` (preferred) or `ARN_HIDDEN_CATEGORY_NAME` for the existing hidden category.
2. Run `npm run setup:intake`. It should create or reuse `#arn-ingest` under that category, hide it from `@everyone`, grant Sentinel read/history/webhook-metadata access, and print `ARN_INGEST_CHANNEL_ID`.
3. Create an incoming Discord webhook in `#arn-ingest` named exactly `ARN - Genesis 1`.
4. Create a second incoming webhook in the same channel named exactly `ARN - Astraeos`.
5. Put the `ARN - Genesis 1` webhook URL in Gen1's Shiny `[ShinyDiscord]` block and the `ARN - Astraeos` webhook URL in Astraeos' Shiny block. Do not commit or paste either URL into the repository.
6. Set `ARN_INGEST_CHANNEL_ID` to the provisioned channel ID and choose the public channel that will hold the single ARN bounty-board message as `ARN_OUTPUT_CHANNEL_ID`.
7. Leave `ARN_AUTO_DISCOVER_WEBHOOKS=true`. `GEN1_SHINY_WEBHOOK_ID`, `ASTRAEOS_SHINY_WEBHOOK_ID`, and `ARN_SHINY_WEBHOOK_MAP_JSON` may remain blank for the first naming-discovery test.
8. Start with `ARN_DRY_RUN=true`. Start Sentinel and confirm it enumerates the hidden channel webhooks, logs `ARN - Genesis 1 -> Genesis 1` and `ARN - Astraeos -> Astraeos`, and never prints webhook URLs/tokens.
9. Trigger or wait for a Shiny spawn on each map. Sentinel should identify the correct map from the discovered webhook ID and log the reconstructed board state without posting publicly.
10. If a new correctly named `ARN - [mapname]` webhook is created while Sentinel is already running, send one Shiny event through it. Sentinel should refresh the channel webhook metadata once, learn the new ID, and retry the event.
11. Optionally pin the discovered webhook IDs in Railway using `GEN1_SHINY_WEBHOOK_ID`, `ASTRAEOS_SHINY_WEBHOOK_ID`, or `ARN_SHINY_WEBHOOK_MAP_JSON`. If a pinned ID's webhook name disagrees with the configured map, Sentinel should warn and retain the pinned ID mapping.
12. Confirm a deliberately mismatched Shiny payload/footer map produces a cross-wiring warning while retaining the webhook's registered map identity.
13. Set `ARN_DRY_RUN=false` and restart the prototype. Sentinel should discover an existing ARN board or create exactly one new board message and log its message ID.
14. Trigger a Shiny detection. The creature should appear as `ACTIVE` under the correct map without creating a second public message. The entry should show `Threat Level - [level]`.
15. Trigger or wait for the same Shiny to be tamed. The board entry should change to `CAPTURED`, remain visible for `ARN_RESOLVED_TTL_SECONDS` (default 180 seconds), then disappear.
16. Trigger or wait for the same Shiny to be killed. The board entry should change to `DEFEATED`, remain visible for the same resolved TTL, then disappear.
17. Allow a Shiny to despawn. The board entry should change to `SIGNAL LOST`, remain visible for `ARN_LOST_TTL_SECONDS` (default 60 seconds), then disappear.
18. Restart the prototype while detections are present. Sentinel should replay recent hidden-ingest messages and rebuild the board from Discord history.

Expected examples:

- Genesis 1 webhook + `Enraged Rex` -> Genesis 1, `Threat Level - KAIJU`, active bounty shows the 1 Tekgram termination reward.
- Astraeos webhook + `Burning Argentavis` -> Astraeos, `Threat Level - CRITICAL`.
- `Pygmy Manta` -> `Threat Level - ELEVATED` because Pygmy is a documented Shiny attribute.
- `Princess Equus`, `Noir Megalodon`, `Xanthic Dodo`, or another unmatched color-set name -> `Threat Level - WATCH` / `Chromatic` unless a documented ability is also present.
- Any message from a webhook that is neither explicitly mapped nor named `ARN - [mapname]` -> ignored.
- One accepted Shiny lifecycle event -> one edit to the existing bounty board, not a new public alert message.

## Known prototype correlation limit

Shiny does not expose a guaranteed unique ARK creature ID in the Discord event. Sentinel currently correlates lifecycle events by map + full Shiny creature name. If two identical names are active on one map, it updates the newest matching signal and writes an ambiguity warning to the log.

Rollback is immediate: stop the prototype and point each map's Shiny configuration back to its original public Discord webhook/channel. No ARK server plugin, ArkAPI dependency, or Shiny modification is required.

Do not commit Discord bot tokens or webhook URLs. Keep them in Railway/environment variables only.

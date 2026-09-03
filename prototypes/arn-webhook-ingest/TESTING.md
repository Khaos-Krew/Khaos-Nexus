# ARN Prototype Test Plan

1. Create a private Discord channel such as `#arn-ingest` that normal members cannot view.
2. Create a dedicated Discord webhook in that channel for Genesis 1.
3. Create a second dedicated Discord webhook in that same channel for Astraeos.
4. Put the Genesis 1 webhook URL in Gen1's Shiny `[ShinyDiscord]` block and the Astraeos webhook URL in Astraeos' Shiny block.
5. Add Sentinel to `#arn-ingest` with View Channel and Read Message History permissions.
6. Choose the public channel that will hold the single ARN bounty-board message and set its ID as `ARN_OUTPUT_CHANNEL_ID`.
7. Set `ARN_INGEST_CHANNEL_ID`, `GEN1_SHINY_WEBHOOK_ID`, and `ASTRAEOS_SHINY_WEBHOOK_ID`. Unknown webhook IDs are rejected.
8. Start with `ARN_DRY_RUN=true`. Trigger or wait for a Shiny spawn on each map and confirm Sentinel identifies the correct map and logs the reconstructed board state without posting publicly.
9. Confirm a deliberately mismatched payload/footer produces a cross-wiring warning while retaining the webhook's registered map identity.
10. Set `ARN_DRY_RUN=false` and restart the prototype. Sentinel should discover an existing ARN board or create exactly one new board message and log its message ID.
11. Trigger a Shiny detection. The creature should appear as `ACTIVE` under the correct map without creating a second public message.
12. Trigger or wait for the same Shiny to be tamed. The board entry should change to `CAPTURED`, remain visible for `ARN_RESOLVED_TTL_SECONDS` (default 180 seconds), then disappear.
13. Trigger or wait for the same Shiny to be killed. The board entry should change to `DEFEATED`, remain visible for the same resolved TTL, then disappear.
14. Allow a Shiny to despawn. The board entry should change to `SIGNAL LOST`, remain visible for `ARN_LOST_TTL_SECONDS` (default 60 seconds), then disappear.
15. Restart the prototype while detections are present. Sentinel should replay recent hidden-ingest messages and rebuild the board from Discord history.

Expected examples:

- Genesis 1 webhook + `Enraged Rex` -> Genesis 1, `KAIJU`, active bounty shows the 1 Tekgram termination reward.
- Astraeos webhook + `Princess Equus` -> Astraeos, `SEVERE`.
- `Noir Megalodon`, `Pygmy ...` -> `SEVERE`.
- Unknown prefixes -> `WATCH`.
- Any message from an unregistered webhook -> ignored.
- One accepted Shiny lifecycle event -> one edit to the existing bounty board, not a new public alert message.

## Known prototype correlation limit

Shiny does not expose a guaranteed unique ARK creature ID in the Discord event. Sentinel currently correlates lifecycle events by map + full Shiny creature name. If two identical names are active on one map, it updates the newest matching signal and writes an ambiguity warning to the log.

Rollback is immediate: stop the prototype and point each map's Shiny configuration back to its original public Discord webhook/channel. No ARK server plugin, ArkAPI dependency, or Shiny modification is required.

Do not commit Discord bot tokens or webhook URLs. Keep them in Railway/environment variables only.

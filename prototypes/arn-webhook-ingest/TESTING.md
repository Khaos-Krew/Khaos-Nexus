# ARN Prototype Test Plan

1. Create a private Discord channel such as `#arn-ingest` that normal members cannot view.
2. Create a dedicated Discord webhook in that channel for Genesis 1.
3. Create a second dedicated Discord webhook in that same channel for Astraeos.
4. Put the Genesis 1 webhook URL in Gen1's Shiny `[ShinyDiscord]` block and the Astraeos webhook URL in Astraeos' Shiny block.
5. Add Sentinel to `#arn-ingest` with View Channel and Read Message History permissions.
6. Set `ARN_INGEST_CHANNEL_ID` to the private channel ID and `ARN_OUTPUT_CHANNEL_ID` to the public ARN/cluster channel ID.
7. Set `GEN1_SHINY_WEBHOOK_ID` and `ASTRAEOS_SHINY_WEBHOOK_ID` to the IDs of their dedicated Discord webhooks. Unknown webhook IDs are rejected.
8. Start with `ARN_DRY_RUN=true`. Trigger or wait for a Shiny spawn on each map and confirm Sentinel identifies the correct map from the webhook ID without reposting publicly.
9. Confirm a deliberately mismatched payload/footer produces a cross-wiring warning while retaining the webhook's registered map identity.
10. Set `ARN_DRY_RUN=false` and restart the prototype. Each accepted Shiny source event should produce exactly one classified ARN embed in the shared output channel.

Expected examples:

- Genesis 1 webhook + `Enraged Rex` -> Genesis 1, Class IV / HIGH, termination reward: 1 Tekgram.
- Astraeos webhook + `Princess Equus` -> Astraeos, Class III / RARE.
- `Noir Megalodon`, `Pygmy ...` -> Class III / RARE.
- Unknown prefixes -> Class I / STANDARD.
- Any message from an unregistered webhook -> ignored.

Rollback is immediate: stop the prototype and point each map's Shiny configuration back to its original public Discord webhook/channel. No ARK server plugin, ArkAPI dependency, or Shiny modification is required.

Do not commit Discord bot tokens or webhook URLs. Keep them in Railway/environment variables only.

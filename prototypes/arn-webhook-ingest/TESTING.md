# ARN Prototype Test Plan

1. Create a private Discord channel such as `#arn-ingest` that normal members cannot view.
2. Point the Shiny Discord webhook for a test server to that channel.
3. Add Sentinel to the channel with View Channel and Read Message History permissions.
4. Set `ARN_INGEST_CHANNEL_ID` to the private channel ID and `ARN_OUTPUT_CHANNEL_ID` to the public ARN/cluster channel ID.
5. Set `GEN1_SHINY_WEBHOOK_ID` and `ASTRAEOS_SHINY_WEBHOOK_ID` when available. With at least one ID configured, messages from any other webhook are ignored.
6. Start with `ARN_DRY_RUN=true`. Trigger or wait for a Shiny spawn and confirm Sentinel logs the parsed event without reposting it.
7. Set `ARN_DRY_RUN=false` and restart the prototype. The next accepted Shiny event should produce a classified ARN embed in the output channel.

Expected examples:

- `Enraged Rex` -> Class IV / HIGH / termination reward: 1 Tekgram.
- `Princess Equus`, `Noir Megalodon`, `Pygmy ...` -> Class III / RARE.
- Unknown prefixes -> Class I / STANDARD.

Rollback is immediate: stop the prototype and point Shiny back to the original public Discord webhook/channel. No ARK server plugin, ArkAPI dependency, or Shiny modification is required.

Do not commit Discord bot tokens or webhook URLs. Keep them in Railway/environment variables only.

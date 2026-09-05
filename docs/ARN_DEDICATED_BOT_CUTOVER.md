# ARN Dedicated Bot Cutover

This document prepares ARN to move out of the Nexus Sentinal Discord process without changing production ARN behavior before cutover.

## Safety rules

- Keep the existing Sentinal ARN path enabled while the dedicated bot runs in `shadow` mode.
- The dedicated service does not receive broad ARK RCON credentials.
- Do not put Discord tokens, database credentials, webhook tokens, or internal job secrets in Git.
- Do not use `ARN_MODE=active` until shadow output is verified and `ARN_CUTOVER_READY=true` is intentionally set.
- `ARN_CLEANUP_SENTINAL_PANELS` stays `false` until Sentinal has stopped managing ARN board messages.
- Threat labels/classification are intentionally NOT redefined by this migration scaffold. The approved ARN threat policy must be migrated as its own source of truth; do not reintroduce the obsolete WATCH/ELEVATED/SEVERE/CRITICAL ladder during cutover.

## Railway service

Create a second service from the same `Khaos-Krew/Khaos-Nexus` repository.

Recommended service name: `nexus-arn`

Dockerfile: `Dockerfile.arn`

Health endpoint: `/health`

Readiness endpoint: `/ready`

Start in shadow mode.

## Owner input / Railway variables

Use `.env.arn.example` as the canonical variable-name template.

### Required for shadow mode

- `ARN_MODE=shadow`
- `ARN_DISCORD_TOKEN` — Bot token from the dedicated ARN Discord application.
- `ARN_DISCORD_GUILD_ID` — Khaos Nexus Discord server/guild ID.

Recommended identity values:

- `ARN_DISCORD_APPLICATION_ID` — application ID from Discord Developer Portal.
- `ARN_DISCORD_CLIENT_ID` — OAuth2/client ID from Discord Developer Portal.

### Required before active cutover

- `ARN_PUBLIC_CHANNEL_ID` — existing public `#arn` channel ID.
- `ARN_INGEST_CHANNEL_ID` — existing private `#arn-ingest` channel ID.
- `ARN_CUTOVER_READY=true` — explicit final activation gate.

### Shared storage / future handoff

- `ARN_DATABASE_URL` — ARN/shared Nexus PostgreSQL connection. If omitted, runtime may fall back to `DATABASE_URL`.
- `ARN_SENTINAL_JOB_ENDPOINT` — future restricted Sentinal job endpoint for reward/action requests.
- `ARN_SENTINAL_JOB_SECRET` — secret authenticating ARN to that restricted job interface.

Do not give ARN the normal Sentinal RCON password simply to deliver anomaly rewards. Sentinal remains the privileged execution layer.

### Optional

- `ARN_RECONCILE_INTERVAL_MS=30000`
- `ARN_CLEANUP_SENTINAL_PANELS=false`

## Discord permissions for dedicated ARN bot

The dedicated ARN application needs access only to ARN-facing Discord resources during the first cutover:

- View Channels
- Read Message History
- Send Messages
- Embed Links
- Manage Messages (needed only if automatic cleanup of old Sentinal-owned ARN panels is approved)
- Manage Webhooks on `#arn-ingest` so ARN can enumerate the existing named per-map webhooks and preserve webhook ID as authoritative map identity

Message Content intent is not required by the polling/replay path.

## Per-map Shiny webhooks

Current ARN discovery uses webhook names in the form:

`ARN - <map name>`

The dedicated service enumerates webhooks from `#arn-ingest`; webhook IDs remain the authoritative map identity. No webhook URL/token is required in ARN environment variables for this path.

## Migration sequence

1. Create the dedicated ARN Discord application and bot.
2. Invite the bot with the ARN-only permissions above.
3. Create the Railway `nexus-arn` service using `Dockerfile.arn`.
4. Add the owner-provided Railway variables, leaving `ARN_MODE=shadow` and `ARN_CUTOVER_READY=false`.
5. Deploy. `/health` should be healthy and `/ready` should turn healthy after the first successful reconcile.
6. Verify logs show the same recognized maps, replay counts, lifecycle state, and tracked anomaly count as the existing Sentinal ARN path.
7. Migrate/finalize the approved ARN threat-policy source of truth before active board ownership. This migration scaffold deliberately does not invent or freeze the wrong threat ladder.
8. Stop Sentinal from owning ARN board/reconcile processing using the dedicated cutover change/feature flag prepared in the final migration PR.
9. Set `ARN_PUBLIC_CHANNEL_ID`, `ARN_INGEST_CHANNEL_ID`, `ARN_MODE=active`, and `ARN_CUTOVER_READY=true` on the ARN Railway service.
10. Keep `ARN_CLEANUP_SENTINAL_PANELS=false` for the first active verification. The dedicated bot creates/updates panels that it owns; Discord messages cannot transfer authorship between bots.
11. After confirming the dedicated panels are correct and Sentinal is no longer writing ARN panels, optionally enable one-time legacy panel cleanup.
12. Remove/disable the old Sentinal ARN preload/listener worker only after the dedicated ARN service has remained stable.

## Rollback

1. Set dedicated ARN service to `ARN_MODE=disabled`.
2. Re-enable the existing Sentinal ARN path if it was disabled.
3. Leave database/event history intact.
4. Do not delete `#arn-ingest`, named map webhooks, or the public ARN channel.

The cutover is intentionally additive until the dedicated service is proven, so rollback does not require restoring deleted state.

## Current scaffold behavior

- `shadow`: dedicated bot logs in, discovers the configured/private ARN intake channel, rebuilds anomaly state from recent intake messages, and logs parity information without writing the public board.
- `active`: requires explicit channel IDs plus `ARN_CUTOVER_READY=true`; the bot rebuilds intake state and owns its own public ARN panel messages.
- `disabled`: no Discord login; health endpoint remains available.
- No direct RCON authority is added.
- No new Discord event listener is used for Shiny intake; reconcile is polling-based.

## Remaining implementation gate

Before production cutover, move the approved ARN threat classifier into a dedicated ARN-owned module and have both shadow parity checks and the dedicated board consume it. This avoids carrying the current transitional classifier forward merely because the bot process changed.

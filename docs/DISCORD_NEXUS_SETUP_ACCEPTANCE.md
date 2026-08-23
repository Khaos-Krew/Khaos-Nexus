# Discord + Nexus Setup Acceptance

This document records the current acceptance checkpoint for the Nexus 0.1 rebuild. It separates evidence that has been verified automatically or from the hosted runtime from evidence that still requires an Owner interaction.

## Checkpoint status

**Checkpoint:** Discord + Nexus Setup Acceptance  
**Active branch:** `rebuild/nexus-0.1`  
**Hosted service:** `nexus-sentinal-0-1-test`  
**Last verified deployment source:** merge commit `f3619d10b82ec67c83509c5983867721fc887641` (PR #316)  
**Verification date:** 2026-08-23

This checkpoint does **not** authorize or imply a public/stable Nexus release.

## Verified without Owner interaction

The PR #316 hosted-provider synchronization path passed the Nexus rebuild CI before merge. The Railway rebuild also completed its Node test suite with 157 passing tests and 0 failures before the deployment image was published.

The resulting Railway deployment reached `SUCCESS` with the configured `/health` deployment health check and a persistent volume mounted for the service.

Hosted runtime startup evidence confirms:

- Nexus Backend started on the internal loopback service.
- Nexus Sentinal Admin started on the hosted admin port.
- Nexus Sentinal logged in to Discord successfully.
- Persistent module feeds were enabled for the configured guild.
- The administrator `/clear` moderation command registered successfully.
- The module access menu reconciled on startup with **10 roles, 1 menu message, and 0 warnings**.
- `/nexus-pair` registered successfully.
- `/pogo` registered successfully.
- The friendly command set registered successfully: `/nexus`, `/market`, `/ark`, `/palworld`, `/minecraft`, `/warframe`, `/division2`, `/rust`, `/satisfactory`, and `/idleon`.
- Command registration preserved unrelated guild commands instead of replacing the guild command set.

The live Railway configuration uses a persistent volume at `/app/data`. Sentinal's normal state store resolves to that directory by default. The hosted-provider store is required to honor the same `NEXUS_DATA_DIR` override when one is configured so alternate hosts cannot split Discord state and provider state across persistent and ephemeral locations.

## Acceptance surface already implemented

The protected hosted Sentinal admin API provides read-only acceptance endpoints for:

- service/Discord/backend status,
- Discord permissions,
- registered command discovery,
- module channel/layout inspection,
- dry-run role reconciliation,
- rank/SKU mapping discovery,
- hosted provider configuration status,
- consolidated `/v1/scan` acceptance evidence.

Repair actions remain authenticated and separate from read-only inspection. Hosted provider credentials are not returned by the acceptance surface.

## Still requires Owner interaction

The following items remain intentionally **pending** because they require a real Owner action or real provider credentials and cannot be inferred from CI, a deployment success, or startup logs:

1. Pair the Windows Nexus desktop to the hosted Sentinal using a fresh one-time `/nexus-pair` code.
2. Run the Setup Center hosted scan from the paired desktop and review its real-guild permission/channel/rank/provider results.
3. Exercise `/nexus setup` or the Setup Center repair flow against the live guild where a repair is actually required, confirming the resulting Discord layout visually.
4. Sync at least one real game-provider configuration from the desktop to hosted Sentinal and run its read-only provider validation, beginning with Palworld when credentials are available.
5. Confirm a desktop restart and a hosted Sentinal restart retain the paired/admin configuration and expected Discord topology without duplicate consoles, menus, or roles.

These Owner gates must remain pending until they are actually exercised.

## Exit criteria

Discord + Nexus Setup Acceptance is complete when the Owner interaction items above are exercised successfully, no unresolved red acceptance section remains in Setup Center, restart persistence is confirmed, and no repair operation creates duplicate Discord topology.

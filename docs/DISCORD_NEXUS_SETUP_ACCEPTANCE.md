# Discord + Nexus Setup Acceptance

This document records the current acceptance checkpoint for the Nexus 0.1 rebuild. It separates evidence that has been verified automatically or from the hosted runtime from evidence that still requires an Owner interaction.

## Checkpoint status

**Checkpoint:** Discord + Nexus Setup Acceptance  
**Active branch:** `rebuild/nexus-0.1`  
**Hosted service:** `nexus-sentinal-0-1-test`  
**Last verified deployment source:** merge commit `f3619d10b82ec67c83509c5983867721fc887641` (PR #316)  
**Latest validated desktop acceptance implementation:** PR #319 head `298baec7b1800e0170f2f6ac94e03fd961fc4128` (Nexus Rebuild CI #235 passed)  
**Verification date:** 2026-08-24

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

The live Railway configuration uses a persistent volume at `/app/data`. Sentinal's normal state store resolves to that directory by default. PR #317 aligns hosted-provider storage with the same `NEXUS_DATA_DIR` contract so alternate hosts do not split Discord state and provider state across persistent and ephemeral locations.

## Owner interaction evidence observed

Owner acceptance testing on 2026-08-24 established useful partial evidence for the desktop-to-hosted Discord admin path:

- the Discord Admin page reached the intended hosted Sentinal and reported Sentinal online, **5/5 permissions**, layout, rank, and registered-command readiness;
- the original aggregate Scan request exposed a client-side false-timeout defect, repaired by PR #318;
- after that repair, the hosted `/v1/scan` request completed with HTTP 200 in roughly 3 seconds, confirming the request/transport path itself was working;
- the desktop then exposed a second presentation defect: completed read-only scans with acceptance findings used `ok: false`, and the generic action helper rendered them as `Operation failed.` instead of showing the findings;
- PR #319 repairs that presentation path and exposes per-section acceptance findings, rank/Premium SKU discovery, and hosted provider configuration status;
- PR #318 head `f23ea665e7453d21f47bc7c3ba93c3bdb16745ee` passed Nexus Rebuild CI #233, and PR #319 head `298baec7b1800e0170f2f6ac94e03fd961fc4128` passed Nexus Rebuild CI #235 before merge.

This is meaningful Owner-test progress, but it is **not** final Discord + Nexus Setup Acceptance. The PR #319 build still needs to be exercised by the Owner so the actual acceptance findings can be reviewed and any genuine red sections can be separated from UI/transport defects.

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

The following items remain intentionally **pending or partially complete** because they require a real Owner action or real provider credentials and cannot be inferred from CI, a deployment success, or startup logs:

1. Confirm the intended one-time `/nexus-pair` → HTTPS exchange → protected credential-storage flow on the current desktop build. The successful authenticated hosted-admin scan is supporting evidence that desktop-to-hosted administration is reachable, but it does not by itself prove the complete fresh-code pairing ceremony.
2. Re-run the Setup Center/Discord Admin hosted scan on the PR #319 implementation, review the real per-section findings now that the UI renders them correctly, and record which sections are green versus genuinely need attention.
3. Exercise `/nexus setup` or the Setup Center repair flow against the live guild where a repair is actually required, confirming the resulting Discord layout visually.
4. Sync at least one real game-provider configuration from the desktop to hosted Sentinal and run its read-only provider validation, beginning with Palworld when credentials are available.
5. Confirm a desktop restart and a hosted Sentinal restart retain the paired/admin configuration and expected Discord topology without duplicate consoles, menus, or roles.

These Owner gates must remain pending until they are actually exercised.

## Exit criteria

Discord + Nexus Setup Acceptance is complete when the Owner interaction items above are exercised successfully, no unresolved red acceptance section remains in Setup Center/Discord Admin, restart persistence is confirmed, and no repair operation creates duplicate Discord topology.

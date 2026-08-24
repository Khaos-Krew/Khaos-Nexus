# Discord + Nexus Setup Acceptance

This document records the current acceptance checkpoint for the Nexus 0.1 rebuild. It separates evidence that has been verified automatically or from the hosted runtime from evidence that still requires an Owner interaction.

## Checkpoint status

**Checkpoint:** Discord + Nexus Setup Acceptance  
**Active branch:** `rebuild/nexus-0.1`  
**Hosted service:** `nexus-sentinal-0-1-test`  
**Last verified deployment source:** merge commit `f3619d10b82ec67c83509c5983867721fc887641` (PR #316)  
**Latest validated desktop acceptance implementation:** PR #321 head `1aa71b57cb4b40ab29502990737315ee84524ad8` (Nexus Rebuild CI #242 passed)  
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
- PR #319 repaired that presentation path, after which the Owner acceptance scan was green in every surfaced section except Rank / SKU discovery;
- repository inspection of that remaining red section established that the five paid Nexus ranks are **Discord Server Shop Premium Roles**, not Premium App SKUs owned by the Nexus Sentinal application. The rebuild had incorrectly reintroduced Premium App SKU discovery as a required acceptance gate;
- PR #320 restores the correct authority split: when no paid `rankSkus` mappings are explicitly configured, Discord Server Shop roles are authoritative, paid Server Shop roles are protected from Nexus reconciliation ownership, and only the free Shadow Recruit baseline is Nexus-managed. Explicit Premium App SKU mappings still enable the Premium App entitlement path;
- PR #321 aligns the desktop discovery/admin presentation with that runtime authority so Server Shop-managed paid ranks are not shown as missing Premium App SKUs;
- PR #320 head `a4b880a64bed3ba4d1d911126939ef425bd56617` passed Nexus Rebuild CI #240, and PR #321 head `1aa71b57cb4b40ab29502990737315ee84524ad8` passed Nexus Rebuild CI #242 before merge.

This is meaningful Owner-test progress, but it is **not** final Discord + Nexus Setup Acceptance. The PR #321 implementation still needs one confirmation scan so the corrected Server Shop authority presentation can be verified and any remaining genuine red sections can be identified.

## Acceptance surface already implemented

The protected hosted Sentinal admin API provides read-only acceptance endpoints for:

- service/Discord/backend status,
- Discord permissions,
- registered command discovery,
- module channel/layout inspection,
- dry-run role reconciliation,
- rank authority / SKU mapping discovery,
- hosted provider configuration status,
- consolidated `/v1/scan` acceptance evidence.

Repair actions remain authenticated and separate from read-only inspection. Hosted provider credentials are not returned by the acceptance surface.

## Rank authority rule

The current rebuild supports two distinct paid-rank authority modes:

- **Server Shop roles:** the default when no paid Premium App `rankSkus` mappings are explicitly configured. Discord owns the paid Premium Role lifecycle; Nexus does not infer missing Premium App SKUs and does not remove/downgrade paid Server Shop roles. Nexus may manage the free Shadow Recruit baseline.
- **Premium App entitlements:** active only when paid rank SKU mappings are explicitly configured. In that mode the recurring/durable SKU discovery and entitlement reconciliation path remains available.

Do not treat missing Premium App SKUs as an acceptance failure when the intended guild uses Discord Server Shop Premium Roles.

## Still requires Owner interaction

The following items remain intentionally **pending or partially complete** because they require a real Owner action or real provider credentials and cannot be inferred from CI, a deployment success, or startup logs:

1. Confirm the intended one-time `/nexus-pair` → HTTPS exchange → protected credential-storage flow on the current desktop build. The successful authenticated hosted-admin scan is supporting evidence that desktop-to-hosted administration is reachable, but it does not by itself prove the complete fresh-code pairing ceremony.
2. Re-run the Setup Center/Discord Admin hosted scan on the PR #321 implementation and confirm the Server Shop rank authority section no longer reports missing Premium App SKUs for the five paid Server Shop ranks; record any remaining genuine red sections.
3. Exercise `/nexus setup` or the Setup Center repair flow against the live guild where a repair is actually required, confirming the resulting Discord layout visually.
4. Sync at least one real game-provider configuration from the desktop to hosted Sentinal and run its read-only provider validation, beginning with Palworld when credentials are available.
5. Confirm a desktop restart and a hosted Sentinal restart retain the paired/admin configuration and expected Discord topology without duplicate consoles, menus, or roles.

These Owner gates must remain pending until they are actually exercised.

## Exit criteria

Discord + Nexus Setup Acceptance is complete when the Owner interaction items above are exercised successfully, no unresolved red acceptance section remains in Setup Center/Discord Admin, restart persistence is confirmed, and no repair operation creates duplicate Discord topology.

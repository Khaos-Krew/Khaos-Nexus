# Discord + Nexus Setup Acceptance

This document records the current acceptance checkpoint for the Nexus 0.1 rebuild. It separates evidence that has been verified automatically or from the hosted runtime from evidence that still requires an Owner interaction.

## Checkpoint status

**Checkpoint:** Discord + Nexus Setup Acceptance  
**Active branch:** `rebuild/nexus-0.1`  
**Hosted service:** `nexus-sentinal-0-1-test`  
**Latest verified hosted deployment source:** merge commit `1832bcc34dfb454f42d6a89b11a3d858d890da2a`  
**Latest validated desktop acceptance implementation:** PR #321 head `1aa71b57cb4b40ab29502990737315ee84524ad8` (Nexus Rebuild CI #242 passed)  
**Verification date:** 2026-08-24

This checkpoint does **not** authorize or imply a public/stable Nexus release.

## Verified without Owner interaction

The hosted Sentinal continues to pass its deployment health check with the persistent `/app/data` volume mounted. The latest verified Railway deployment reached `SUCCESS` and produced the following runtime evidence:

- Nexus Backend started on the internal loopback service.
- Nexus Sentinal Admin started on the hosted admin port.
- Nexus Sentinal logged in to Discord successfully.
- Persistent module feeds were enabled for the configured guild.
- The administrator `/clear` moderation command registered successfully.
- `/nexus-pair` registered successfully.
- `/pogo` registered successfully.
- The expanded module access menu reconciled on startup with **13 roles, 1 menu message, and 0 warnings**.
- The friendly command set registered successfully: `/nexus`, `/market`, `/ark`, `/cod`, `/dbd`, `/diablo4`, `/palworld`, `/minecraft`, `/warframe`, `/division2`, `/rust`, `/satisfactory`, and `/idleon`.
- Command registration preserved unrelated guild commands instead of replacing the guild command set.
- Managed game hubs reconciled with **12 panels, 0 created, 0 duplicates removed, and 0 pins added**.
- Call of Duty, Dead by Daylight, and Diablo IV each reused their intended category/hub with `created=false` and `channelsAdded=0`.
- Module channel access reconciliation covered **12 modules with 0 permission changes and 0 blocked modules**.
- Managed game categories were placed above the protected Staff boundary in alphabetical order: ARK Survival Ascended, Call of Duty, Dead by Daylight, Diablo IV, Legends of IdleOn, Minecraft, Palworld, Pokémon GO, Rust, Satisfactory, The Division 2, Warframe.
- A later periodic managed-hub sweep again reported **12 panels, 0 created, and 0 duplicates removed**, providing restart/periodic idempotency evidence for the current topology.
- Persistent feed actions recovered or updated existing Discord messages with no duplicate cleanup required across the configured Palworld, Satisfactory, Rust, Minecraft, ARK, Pokémon GO, Division 2, and Warframe feeds.
- The current self-role set reconstructed **11 menus / 120 roles** from live Discord messages with zero legacy reaction candidates remaining.
- The private safety-report runtime reported `staffRoles=3`, Rules panel ready, and restricted archive ready.
- The required public `sentinal-role-authority:100` milestone note posted exactly once to `#patch-notes`, with the publisher reporting `posted=1 adopted=0 skipped=1 warnings=0`.

The live Railway configuration uses a persistent volume at `/app/data`. Sentinal state and hosted-provider storage follow the shared `NEXUS_DATA_DIR` contract so Discord state and provider state do not split between persistent and ephemeral locations.

### Name Color hierarchy note

The role reconciler still emits a bounded warning that selectable color-role priority cannot be fully applied to staff members without placing shared color roles above a protected moderation role. This is expected under the approved hierarchy policy: Sentinal must not weaken moderation/admin authority merely to force a staff display color. Issue #350 tracks the separate staff-compatible presentation design and requires a preview before any live staff-role appearance migration.

## Owner interaction evidence observed

Owner acceptance testing on 2026-08-24 established useful partial evidence for the desktop-to-hosted Discord admin path:

- the Discord Admin page reached the intended hosted Sentinal and reported Sentinal online, **5/5 permissions**, layout, rank, and registered-command readiness;
- the original aggregate Scan request exposed a client-side false-timeout defect, repaired by PR #318;
- after that repair, the hosted `/v1/scan` request completed with HTTP 200 in roughly 3 seconds, confirming the request/transport path itself was working;
- the desktop then exposed a second presentation defect: completed read-only scans with acceptance findings used `ok: false`, and the generic action helper rendered them as `Operation failed.` instead of showing the findings;
- PR #319 repaired that presentation path, after which the Owner acceptance scan was green in every surfaced section except Rank / SKU discovery;
- repository inspection of that remaining red section established that the five paid Nexus ranks are **Discord Server Shop Premium Roles**, not Premium App SKUs owned by the Nexus Sentinal application;
- PR #320 restores the correct authority split: when no paid `rankSkus` mappings are explicitly configured, Discord Server Shop roles are authoritative, paid Server Shop roles are protected from Nexus reconciliation ownership, and only the free Shadow Recruit baseline is Nexus-managed. Explicit Premium App SKU mappings still enable the Premium App entitlement path;
- PR #321 aligns the desktop discovery/admin presentation with that runtime authority so Server Shop-managed paid ranks are not shown as missing Premium App SKUs;
- PR #320 head `a4b880a64bed3ba4d1d911126939ef425bd56617` passed Nexus Rebuild CI #240, and PR #321 head `1aa71b57cb4b40ab29502990737315ee84524ad8` passed Nexus Rebuild CI #242 before merge.

This is meaningful Owner-test progress, but it is **not** final Discord + Nexus Setup Acceptance. The corrected PR #321 presentation still needs one Owner confirmation scan so the Server Shop authority view and any remaining genuine red sections can be observed on the desktop build itself.

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

The following items remain intentionally **pending or partially complete** because they require a real Owner action, normal-member interaction, or real provider credentials and cannot be inferred from CI or startup logs:

1. Confirm the intended one-time `/nexus-pair` → HTTPS exchange → protected credential-storage flow on the current desktop build. The successful authenticated hosted-admin scan is supporting evidence that desktop-to-hosted administration is reachable, but it does not by itself prove the complete fresh-code pairing ceremony.
2. Re-run the Setup Center/Discord Admin hosted scan on the PR #321 implementation and confirm the Server Shop rank authority section no longer reports missing Premium App SKUs for the five paid Server Shop ranks; record any remaining genuine red sections.
3. Exercise `/nexus setup` or the Setup Center Repair Nexus flow against the live guild only where a repair is actually required, then confirm the resulting Discord layout visually. Startup reconciliation has already proven the current managed layout can remain stable without duplicate creation.
4. Sync at least one real game-provider configuration from the desktop to hosted Sentinal and run its read-only provider validation, beginning with Palworld when credentials are available.
5. Confirm a desktop restart retains the paired/admin configuration. Hosted Sentinal restart persistence has partial evidence through repeated Railway deployments and persistent Discord message recovery, but the full desktop + hosted pairing persistence ceremony still needs Owner confirmation.
6. Exercise normal-member module access buttons/commands to prove the matching access role grants the expected module visibility while nonmatching game roles remain isolated and staff/admin visibility remains intact.
7. Exercise one complete private report lifecycle from report creation through claim/evidence/resolve/close/archive and verify the restricted archive permissions from the intended staff accounts.

These Owner/live-interaction gates must remain pending until they are actually exercised.

## Exit criteria

Discord + Nexus Setup Acceptance is complete when the Owner interaction items above are exercised successfully, no unresolved red acceptance section remains in Setup Center/Discord Admin, desktop + hosted pairing persistence is confirmed, real member access isolation is demonstrated, and no repair operation creates duplicate Discord topology.

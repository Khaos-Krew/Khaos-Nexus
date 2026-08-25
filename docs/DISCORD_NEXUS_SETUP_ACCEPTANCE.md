# Discord + Nexus Setup Acceptance

This document records the current acceptance checkpoint for the Nexus 0.1 rebuild. It separates evidence that has been verified automatically or from the hosted runtime from evidence that still requires an Owner or normal-member interaction.

## Checkpoint status

**Checkpoint:** Discord + Nexus Setup Acceptance — Sentinel/backend phase  
**Active branch:** `rebuild/nexus-0.1`  
**Hosted service:** `nexus-sentinal-0-1-test`  
**Latest verified hosted deployment source:** commit `23b6ec2631cac5f5d83927dad966f0831e3972e2`  
**Verification date:** 2026-08-24

This checkpoint does **not** authorize or imply a public/stable Nexus release.

Desktop feature development and desktop-only acceptance ceremonies are intentionally deferred while the Discord/Sentinel/backend ecosystem is brought to a mature, stable acceptance point. Deferred desktop gates are recorded separately below and do not block the active Sentinel/backend checkpoint.

## Verified without Owner interaction

The hosted Sentinal continues to pass its deployment health check with the persistent `/app/data` volume mounted. The latest verified Railway deployment reached `SUCCESS` and the current runtime/test evidence establishes the following:

- Nexus Backend starts on the internal loopback service.
- Nexus Sentinal Admin starts on the hosted admin port.
- Nexus Sentinal logs in to Discord successfully.
- Persistent module feeds are enabled for the configured guild.
- The administrator `/clear` moderation command registers successfully.
- `/nexus-pair` and `/pogo` register successfully.
- The expanded module access menu reconciles with **13 access roles, 1 menu message, and 0 warnings**.
- The friendly command set registers successfully: `/nexus`, `/market`, `/ark`, `/cod`, `/dbd`, `/diablo4`, `/palworld`, `/minecraft`, `/warframe`, `/division2`, `/rust`, `/satisfactory`, and `/idleon`.
- Command registration preserves unrelated guild commands instead of replacing the guild command set.
- Managed game hubs reconcile with **12 Sentinel-owned panels** without duplicate creation.
- Call of Duty, Dead by Daylight, and Diablo IV reuse their intended category/hub instead of creating duplicate topology.
- Sentinel-owned module channel access reconciliation covers the managed game surfaces without blocked modules or permission drift.
- Nexus D&D is explicitly modeled as `surface: veyra` / `console: false`. Its access role and self-service role button remain Sentinel-owned, while its presentation/category visibility is delegated to Veyra instead of being falsely reported as a missing Sentinel game category.
- Managed game categories remain above the protected Staff boundary in alphabetical order.
- Periodic managed-hub sweeps provide restart/idempotency evidence for the current topology.
- Persistent feed actions recover or update existing Discord messages instead of creating deployment duplicates.
- Warframe news, Nightwave, and Steel Path now recover from public leaf-endpoint HTTP 404 responses through the full platform world-state snapshot, while non-404 provider failures still surface normally. The repaired feeds reconciled successfully in the hosted runtime.
- The current self-role set reconstructs the live Discord role menus without leaving legacy reaction-role candidates behind.
- The private safety-report runtime reports configured staff roles, Rules panel readiness, and restricted archive readiness.
- Staff Workspace reconciliation has a canonical protected category, managed hub/admin/roadmap channels, a staff-offices forum, staff voice space, per-staff office threads, legacy-office preservation, and duplicate-safe managed panels.
- The About and ranks publishers adopt and update their canonical existing messages instead of creating deployment duplicates; the ranks publisher resolves all six rank definitions.
- Community leveling registers `/level`, `/rank`, `/leaderboard`, and `/xp` and maintains its canonical level-up surface.
- Community Suggestions now has intake, anti-self-voting, timed vote evaluation, GitHub issue handoff/retry, protected Owner review, public approve/deny feedback, and a trusted GitHub development-plan gate. Owner approval remains locked until a repository Owner/Member/Collaborator plan is imported; the planning handoff is idempotent and cannot write to GitHub without the configured token.
- The required public milestone publisher remains constrained to 66% and 100% public-safe patch notes and maintains its publication ledger.

The live Railway configuration uses a persistent volume at `/app/data`. Sentinal state and hosted-provider storage follow the shared `NEXUS_DATA_DIR` contract so Discord state and provider state do not split between persistent and ephemeral locations.

### Name Color hierarchy note

The role reconciler may emit a bounded warning when selectable color-role priority cannot be fully applied to staff members without placing shared color roles above a protected moderation role. This is expected under the approved hierarchy policy: Sentinal must not weaken moderation/admin authority merely to force a staff display color. Any separate staff-compatible presentation migration requires its own preview and live acceptance.

## Hosted/runtime acceptance progress

The current backend-first checkpoint has removed several false or obsolete acceptance failures:

- Server Shop Premium Roles remain the authority for paid Nexus ranks unless Premium App SKU mappings are explicitly configured.
- Module-access preflight no longer performs an unnecessary second Discord channel fetch from a snapshot and no longer throws the former `managedCategoryChannels is not a function` error.
- Nexus D&D is no longer treated as a missing Sentinel-managed game category; it is a delegated Veyra surface while its access-role/button contract remains auditable.
- Warframe leaf-endpoint 404s no longer break the news, Nightwave, or Steel Path feed reconciliations.
- Community Suggestions no longer allows a passed raw GitHub issue to jump directly to implementation approval without an implementation plan.

These are meaningful hosted acceptance improvements, but they do **not** replace the human interaction tests below.

## Acceptance surface already implemented

The protected hosted Sentinal admin API provides read-only acceptance endpoints for:

- service/Discord/backend status,
- Discord permissions,
- registered command discovery,
- module channel/layout inspection,
- dry-run role reconciliation,
- rank authority / SKU mapping discovery,
- hosted provider configuration status,
- consolidated acceptance evidence.

Repair actions remain authenticated and separate from read-only inspection. Hosted provider credentials are not returned by the acceptance surface.

## Rank authority rule

The current rebuild supports two distinct paid-rank authority modes:

- **Server Shop roles:** the default when no paid Premium App `rankSkus` mappings are explicitly configured. Discord owns the paid Premium Role lifecycle; Nexus does not infer missing Premium App SKUs and does not remove/downgrade paid Server Shop roles. Nexus may manage the free Shadow Recruit baseline.
- **Premium App entitlements:** active only when paid rank SKU mappings are explicitly configured. In that mode the recurring/durable SKU discovery and entitlement reconciliation path remains available.

Do not treat missing Premium App SKUs as an acceptance failure when the intended guild uses Discord Server Shop Premium Roles.

## Still requires live Owner/member interaction

The following items remain intentionally pending or partially complete because they require a real Owner action, a normal-member interaction, or real provider credentials and cannot be inferred from CI/startup logs:

1. Exercise a normal-member module access button end to end: assign a managed game role, confirm the matching managed module becomes visible, confirm unrelated managed game categories remain isolated, remove the role, and confirm access is removed. Confirm staff/admin visibility remains intact. D&D should be tested according to the Veyra presentation contract rather than a Sentinel game-console category.
2. Exercise one complete private report lifecycle from Rules → report modal/ticket → staff claim → evidence handling → resolve/close → restricted archive, and verify the reporter/staff/archive permission boundaries from the intended accounts.
3. Verify the protected Staff Workspace from an Owner/staff account and a normal-member account: managed staff channels remain private, the canonical staff-offices forum is usable, office threads are present for intended staff, and no preserved legacy office history became public during migration.
4. Exercise Community XP with real Discord activity: text award/cooldown behavior, voice award behavior where configured, level-up announcement, `/level`, `/rank`, `/leaderboard`, administrative `/xp` authorization, and persistence across a hosted restart.
5. Visually confirm the canonical `#about` and `#ranks` surfaces contain the intended current copy and links after Sentinel adoption. Runtime evidence already proves canonical reuse/deduplication; this gate is content/presentation acceptance only.
6. Submit one real Community Suggestion and carry it through the complete live workflow: self-vote prevention, community vote gate, GitHub issue creation, planning-request comment, trusted development-plan import, Owner approve or deny, and public Discord status/reason update. Until one real suggestion completes this path, Community Suggestions remains below 100% acceptance.
7. Sync/configure at least one real hosted game provider when credentials or server details are available and run the read-only provider validation. This does not require resuming desktop development; the hosted/backend path is the active authority.
8. Use `/nexus setup` or a protected repair action against the live guild only when a genuine repair is required, then confirm the result visually and verify a subsequent restart/reconciliation does not duplicate topology.

## Deferred desktop acceptance — does not block this checkpoint

The following previously listed items remain valid future acceptance work but are intentionally deferred until desktop development resumes from its hardened checkpoint:

- fresh `/nexus-pair` → HTTPS exchange → protected desktop credential-storage ceremony;
- current desktop Setup Center/Discord Admin presentation scan;
- desktop-driven provider configuration sync;
- desktop restart retaining paired/admin configuration;
- any desktop-only updater or administrative UX acceptance that is not required for hosted Sentinel operation.

Do not resume desktop feature development merely to close these items while the Discord/Sentinel/backend ecosystem is still the active production priority.

## Exit criteria for the active checkpoint

The **Sentinel/backend phase** of Discord + Nexus Setup Acceptance is complete when:

- the live Owner/member interaction items above are exercised successfully or explicitly scoped to a later module-specific beta;
- no unresolved red hosted acceptance section remains;
- normal-member game access isolation and staff/admin visibility are demonstrated;
- the private safety-report lifecycle and Staff Workspace privacy boundaries are demonstrated;
- Community XP persistence/authorization is demonstrated;
- no protected repair or restart creates duplicate Discord topology; and
- provider/runtime failures that affect enabled production surfaces are either repaired or explicitly degraded with accurate user-facing status.

Desktop pairing and desktop persistence are **not** exit criteria for this backend-first phase. They become acceptance gates again only when the desktop workstream is intentionally resumed.

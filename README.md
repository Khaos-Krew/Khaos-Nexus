# Khaos Nexus 0.1.0 Rebuild

This branch is the active clean rebuild of Khaos Nexus. The previous `0.41.x` stabilization line is preserved as legacy/rollback/reference material rather than the active implementation target.

> **Active implementation branch:** `rebuild/nexus-0.1`  
> **Current package version:** `0.1.0`  
> **Current phase:** rebuild foundation + provider services + Sentinal acceptance + release hardening  
> **Public/stable release:** not established by this branch, package version, CI, deployment, or merge state alone

## Product boundaries

- **Nexus Backend** owns game logic, providers, scheduling hooks, permissions, health, and shared contracts.
- **Nexus Sentinal** is the primary Discord interface for normal game-module use through persistent consoles, setup/reconciliation, friendly commands, event feeds, self-role/rank surfaces, private reporting, community progression, staff operations, security review, and deeper controls.
- **Khaos Nexus Desktop** is an Admin Control Center for Discord/Sentinal administration, accounts/access, module/service management, owner testing, diagnostics, recovery, updates, and the private assistant bridge.
- Private assistant functionality remains local/private and is bridged from its canonical project rather than duplicated into public Sentinal surfaces.
- **Veyra** is the authoritative owner of D&D domain state, campaign truth, permissions, and gameplay contracts. Nexus may provide a bounded authenticated gateway, health evidence, and identity context, but it does not persist competing campaign state.

Routine game logic remains outside Electron and Discord handlers.

## Current implementation state

The rebuild includes the thin Electron Admin Control Center, backend module/runtime foundations, shared scheduler, Discord provisioning/reconciliation, temporary voice lobbies, permission preflight, persistent Sentinal module consoles, household Accounts & Access, guarded read-only provider validation, staged updating, Admin Operations / Owner Test Center, backend-first Pokémon GO, friendly per-module commands, universal event/schedule feeds, supporter-rank handling and Premium App entitlement reconciliation, self-reconciling module access roles, hosted Sentinal pairing, guided Setup Center, hosted provider synchronization, Discord Admin acceptance tooling, Discord Server Shop rank authority, managed ranks presentation, private safe-space reporting, Community Suggestions voting and protected Owner review, community XP/leveling, protected Staff workspace tooling, milestone patch-note publishing, new-member welcome automation, persistent Nexus service status, managed Community About & Sharing, Content Creator application/review/lifecycle infrastructure, and a repository-present Sentinal Shield security/review/isolation layer.

Current accepted-baseline game modules include **ARK, Palworld, Minecraft, Warframe, Division 2, Rust, Satisfactory, IdleOn, Nexus D&D, Pokémon GO, Call of Duty, Dead by Daylight, and Diablo IV**. The rebuild also registers **7 Days to Die, Conan Exiles, and Destiny 2** as access-only module hubs; those three intentionally advertise no backend actions until provider/API work is implemented and accepted. Newer branch-tip module work must still be separately verified and validated before being presented as accepted provider-backed functionality.

Provider-backed companion work includes capability-driven module help, read-only Warframe Archon Hunt data, the interactive `/ark tame` wizard, Pokémon GO event/operation surfaces, Dead by Daylight public/community reads through Tricky/NightLight, and safe/local Call of Duty and Diablo IV companion surfaces that deliberately avoid undocumented protected player-data routes or nonexistent live character/inventory APIs.

**Sentinal owns the role/self-role authority path.** The merged chain covers unified self-role/color menus (#329), legacy discovery/migration (#330/#331), old button-menu adoption (#335), safe target diagnostics/aliases (#339/#341), Name Color swatch preservation and restart recovery (#342/#343), strict module access policy (#344), application-owned live-role-hex color swatches (#345/#346), owner-approved platform-role/LFG/legacy-panel cleanup (#351), Guild Members intent corrections (#352–#354), serialized reconciliation after live cleanup (#355), the required 100% public milestone publisher update (#356), and staff-compatible Name Color preview/display diagnostics (#360/#361).

Live evidence records the **Sentinal Discord Role Authority section as accepted at 100%** with 11 current self-role menus, 120 active role options, duplicate platform roles removed, zero legacy reaction candidates remaining, and moderation hierarchy preserved. The expanded module-access surface reconciles at **13 roles / 1 menu / 0 warnings**. PR #356 is merged, and Railway confirmed its `sentinal-role-authority:100` milestone posted exactly once to `#patch-notes` with no warnings.

Staff-compatible Name Color display is also live-evidenced without weakening role hierarchy. PRs #360/#361 showed 32 selectable color roles, no colored protected staff role overriding them, `displaySafe=true`, and zero real display conflicts; no staff role color or hierarchy mutation is required.

**Persistent Sentinal panels and module layout are also hardened and live-evidenced.** PR #347 made managed hubs/live feeds deployment-idempotent and #349 added bounded startup acceptance telemetry. PR #357 added backend-first Call of Duty, Dead by Daylight, and Diablo IV modules with dedicated Discord categories/access roles plus alphabetical game-category reconciliation above protected Staff/Hidden boundaries. PR #358 fixed category insertion ordering and added missing-hub self-healing.

Current Railway evidence confirms:

- **12 managed game hub panels**, with `created=0` and `duplicatesRemoved=0` on startup and periodic sweeps;
- Call of Duty, Dead by Daylight, and Diablo IV categories/hubs are present and reused without creating duplicate channels;
- **12 module channel access policies** reconcile with `blocked=0` and no permission drift to repair;
- categories are alphabetized above the protected Staff boundary;
- persistent feed actions recover their existing Discord messages without duplicate cleanup;
- `/nexus`, `/market`, `/ark`, `/cod`, `/dbd`, `/diablo4`, `/palworld`, `/minecraft`, `/warframe`, `/division2`, `/rust`, `/satisfactory`, and `/idleon` register without replacing unrelated guild commands;
- the private safety-report infrastructure reports the Rules panel and restricted archive ready, while end-to-end ticket lifecycle acceptance remains pending;
- **INFO → Nexus Status** maintains one pinned status panel and live probes reported both Nexus Sentinal and Veyra online without duplicate messages;
- `#welcome` has an event-driven Sentinal welcome path for new human members.

Community About & Sharing is merged through PRs #384/#385. Sentinal now manages a canonical pinned `#about` panel with a permanent share link and safe-space copy, and includes a public-safe 100% milestone publisher. PR #384 head `d56bf1ed…` passed Nexus Rebuild CI #405 and PR #385 head `f3c1dd54…` passed CI #407. Those exact-head CI results establish implementation validation only; live guild acceptance and actual milestone publication remain separate evidence.

PR #386 is also merged and exact-head green. Sentinal now manages a canonical ranks panel that can adopt the existing rank embed, preserve Discord Server Shop as paid-rank authority, add the approved Nexus maintenance/funding disclosure, pin one canonical panel, and retire only high-confidence legacy rank panels without mutating paid roles. PR #386 head `70a05897…` passed Nexus Rebuild CI #410. Live guild adoption/reconciliation remains separate acceptance evidence.

**Supporter entitlement handling has advanced beyond presentation-only rank support.** PR #404 merged the pure supporter-rank reconciliation core. PR #408 added the hardened Discord Premium App entitlement adapter while preserving Server Shop authority when paid SKU mappings are absent. PR #410 installed startup/periodic/event-driven Premium App reconciliation and passed Nexus Rebuild CI #581 on exact head `29ef93b6…`. PR #411 merged the Supporter Hub category permission policy and passed CI #582 on exact head `772d69ab…`; it denies `@everyone`, permits configured paid ranks plus legacy Origin Founder, and excludes free Shadow Recruit without flattening child-channel overrides. The Supporter Hub runtime/live accepted-mapping consolidation is **not yet baseline functionality**: PR #412 is open/unmerged even though its exact head `006295ce…` passed CI #585.

**Content Creator Program infrastructure is now merged on the active rebuild.** PR #397 moved the public application entry into `#roles`, enforces the configurable Community Level eligibility gate, and keeps the creator workspace private until approval; exact head `a9ca0219…` passed Nexus Rebuild CI #568. PR #398 added protected request-more-information and creator-revocation controls and passed CI #570 on exact head `04236f38…`. Live creator application/review/role/feed acceptance remains separate from these automated results.

**Community Suggestions is now a merged operational slice.** PR #387 adds durable `SUG-####` IDs, managed Discord intake/voting, self-vote prevention, one changeable vote per member, configurable vote gates, persistent state, and a fail-safe GitHub development queue. PR #389 adds the protected Staff Owner-review queue with explicit approve or required-reason deny decisions and public status reflection. PR #390 adds the public-safe Community Suggestions 66% milestone publisher. Their exact heads passed Nexus Rebuild CI #415, #418, and #419 respectively. Live end-to-end voting, GitHub handoff/retry, Owner decision reflection, and final development-plan approval remain acceptance gates; this is not a 100% completion claim.

**Sentinal Shield is present on the active branch.** The implementation adds private security cases/alerts, conservative scam/phishing/suspicious-link/spam/raid risk handling, protected staff/owner safeguards, reversible timeout/quarantine isolation that preserves unrelated Nexus roles, staff review controls, and a verification-help recovery path. Regression coverage locks restoration of only Shield-owned permission bits and restart-safe isolation state. The older `ba5ff144…` Shield milestone checkpoint is historical branch-tip evidence rather than the current rebuild head; a `sentinel-shield:100` patch-note entry in code is still **not being treated as accepted 100% evidence** without the required exact milestone/live owner acceptance context.

The backend-backed `#game-servers` registry now includes a persistent hosted-server inventory and protected management path behind the Nexus Backend/Sentinal boundary. Exact-head work adds hosted-server persistence, backend management API/client methods, a Sentinal hosted-server admin command/extension, provider/runtime health states, Nitrado-backed Palworld status checks, and a private-safe `/server setup` guide surface. Palworld setup documents the Nitrado service-ID/token-environment flow; Once Human setup is intentionally manual through the official NetEase Custom Server dashboard and exposes a structured configuration catalog without using undocumented private management endpoints. Public Discord cards remain privacy-safe: private servers and protected network addresses, ports, provider references, passwords/tokens, TLS data, and other connection details are excluded.

Late-August acceptance work also added:

- **Community XP/Leveling (#373):** backend-first message/voice/event/module/admin progression with explicit authority separation. Its 100% milestone remains gated on live member, voice, admin, badge, restart-persistence, and authority-isolation testing.
- **Protected Staff workspace (#376–#378):** managed Staff Hub/Ops/Admin Commands, a real `staff-offices` Discord Forum, a managed `#roadmap` panel, safe legacy-office preservation, and legacy Staff Hub adoption. Live staff/non-staff privacy and restart-idempotency acceptance remain pending.
- **Module-access acceptance preflight (#379/#381):** read-only checks for access-button bindings, module-category isolation, permission drift, and staff visibility. The first live deployment exposed a bulk-member-fetch rate-limit collision; #381 fixes that by using a snapshot-only audit with `bulkMemberFetches=0`. A real normal-member button/visibility test is still required and is not replaced by the preflight.

Release hardening has also advanced materially. The rebuild uses deterministic lockfile installs and exact validated-artifact promotion, runs real isolated Windows clean-install/staged-upgrade smoke validation, audits packaged application contents, and has a fail-closed Authenticode policy for stable Windows validation. Owner-test artifacts may remain intentionally unsigned; stable artifacts require protected signing credentials and independently valid signatures. The Windows build path explicitly uses `--publish never`, so ordinary validation cannot accidentally attempt a GitHub release. No public/stable release is authorized merely by these controls.

The exact current rebuild head `a07a1291…` passed **Nexus Rebuild CI #672**. The nine commits since the previous validated `10bc45d4…` head add the Once Human official-dashboard setup catalog, provider setup command surface, cleaner hosted-provider health/status presentation, and focused setup/privacy/runtime regression coverage. This establishes exact-head automated validation only; live hosted-server/Nitrado/Once Human owner acceptance, broader Discord acceptance, and public/stable release status remain separate.

The current [`Discord + Nexus Setup Acceptance`](docs/DISCORD_NEXUS_SETUP_ACCEPTANCE.md) checkpoint remains active. Role authority plus the expanded game-module layout, access-policy reconciliation, category ordering, hub idempotency, feed recovery, staff Name Color display safety, and service-status visibility have live evidence. Fresh pairing, corrected desktop confirmation, real provider sync/validation, module-access interaction, Staff workspace acceptance, Community XP live acceptance, Community Suggestions end-to-end acceptance, Content Creator live acceptance, supporter entitlement/Supporter Hub live acceptance, Shield exact-head/live acceptance, report lifecycle, and desktop/hosted restart persistence still require owner interaction or final live evidence.

## Roadmap

The canonical roadmap/status handoff is [`docs/NEXUS_ROADMAP_STATUS.md`](docs/NEXUS_ROADMAP_STATUS.md).

- **Now — Rebuild foundation:** automated baseline is green; owner-test the packaged Admin Control Center, guided Setup Center, Accounts & Access, Owner Test Center, startup-health surface, Sentinal administration, hosted pairing/provider sync, safe Repair Nexus flow, and current private assistant bridge.
- **Next — Provider-backed game services:** providers, authenticated hosted sync, read-only validation, event feeds, ARK taming, Pokémon GO, Warframe Archon Hunt, Dead by Daylight public/community reads, safe/local Call of Duty/Diablo IV companion surfaces, the backend-backed tracked/hosted-server registry with Nitrado-backed Palworld status plus the privacy-safe Once Human official-dashboard setup guide, and the access-only 7 Days to Die / Conan Exiles / Destiny 2 hubs are the active service path; validate provider-backed behavior in real provider/Discord use without treating CI as live acceptance.
- **Then — Sentinal operational acceptance:** role authority is live-accepted at 100%, and module layout/idempotency, staff-compatible Name Color display safety, Nexus Status, Staff workspace, Community XP/Leveling, Community About & Sharing, managed ranks presentation, Community Suggestions core/Owner review, Content Creator infrastructure, supporter entitlement reconciliation/Supporter Hub policy, the module-access preflight, and Sentinal Shield are implemented at their respective evidence levels; broader acceptance still requires normal-member module interaction, Staff privacy/idempotency, Community XP live checks, About/ranks live acceptance, Community Suggestions end-to-end acceptance, creator application/review/role/feed checks, supporter entitlement/Hub live checks, Shield exact-head/live acceptance, report lifecycle, moderation, pairing, provider flows, Setup Acceptance, and restart behavior.
- **Release hardening:** deterministic installs, exact validated-artifact promotion/provenance, staged updating, Windows clean-install/staged-upgrade smoke validation, package-content auditing, stable signing gates, and the non-publishing Windows validation guard are merged/implemented; next validate the same update/rollback flow on an actual owner installation while keeping public/stable publication a separate explicit decision.
- **Later — Selective migration and expansion:** port only legacy behavior that fits the backend/admin/Sentinal architecture, expand provider-backed services and safe companion reads, keep routine game dashboards out of the desktop, keep private assistant functionality bridged from its canonical project, and consider future web/public surfaces only when they support rather than duplicate protected authority.
- **Final planned continuation — Nexus D&D production and community beta:** after the Nexus 0.1 core/Discord roadmap is stable enough to protect D&D work, transition directly into the dedicated [`Nexus D&D production continuation`](docs/NEXUS_DND_PRODUCTION_CONTINUATION.md). The first checkpoint is canonical content/assets plus a Veyra-owned D&D contract inventory/gap analysis, followed by player-ready character/campaign clients, DM world tools, tactical combat, a Veyra-backed Discord campaign bridge, closed beta, and broader release hardening.

The earlier self-hosted web + Windows Agent roadmap is no longer the immediate successor phase for Nexus 0.1. Nexus D&D production is now an explicit end-of-roadmap continuation rather than an unscheduled backlog item.

## Historical stabilization line

PR #266 on `stabilize/nexus-66-baseline` remains open, draft, and unmerged. Its historical owner-test identity remains `0.41.2.1` visible / `0.41.3-test.1` internal / channel `owner-test` / rollback `v0.41.2-B`.

The newest relevant legacy startup diagnostic remains issue #285 for installed `0.41.3-test.1`, reporting **8 passed, 0 warnings, 0 failures**. It is historical stabilization evidence only and does not validate Nexus 0.1.

## Start

1. Copy `config.example.json` to `config.json`.
2. Fill the required Discord configuration.
3. Set `NEXUS_SENTINEL_TOKEN` in the environment.
4. Set `NEXUS_BACKEND_TOKEN` to a strong shared secret when Sentinal and backend are separate processes.
5. Run `npm ci`.
6. Run `npm run backend`.
7. Run `npm run sentinel`.
8. Run `npm start` for the Admin Control Center.

For the rebuild boundary and migration rules, see [`REBUILD_SCOPE.md`](REBUILD_SCOPE.md). For Discord module provisioning and reconciliation, see [`docs/SENTINAL_DISCORD_MODULE_SETUP.md`](docs/SENTINAL_DISCORD_MODULE_SETUP.md).
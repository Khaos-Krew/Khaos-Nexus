# Khaos Nexus Overnight Production Audit — 2026-09-01

## Scope
- Previous audited code head: `d234b77fe68ffa3f5874844795301ae01b71de24`.
- Audited branch: `rebuild/nexus-0.1`.
- Current pre-audit head: `d7edd6f4c4eb795af9ca2cc24cd0f8549a5f6103` (`Merge pull request #514 ... Deploy single Dino Cache Hub + sealed reveal flow`).
- Delta: **121 commits ahead, 0 behind**.
- Major changed surfaces include ARK dynamic config serving, dino-cache/shop flows, account linking, backend controls, server controls, dynamic events, SFTP mod inventory, ArkShop/MySQL migration, Shiny config runtime, cluster metadata, and supporting tests.

## Deployment state
### Railway: `discerning-purpose` production
- `nexus-sentinal-0-1-test`: **SUCCESS**, deployment `5679c261-d9ff-481b-8c37-5c56c7d1ed3f`, created 2026-09-01T08:35:16Z.
- `nexus-ark-dynamic-config`: **SUCCESS**, deployment `a429bfd6-b6cb-46b0-b02e-62ba1f97044d`.
- Postgres: **SUCCESS**.
- KNX-BUILD-NODE-01/02/03: **SUCCESS**.
- GitHub combined status for head is green for Sentinel, dynamic-config, and build-node-03.

### Railway: `Khaos Nexus Forge`
- `khaos-nexus-forge`: **SUCCESS**.
- Repeated `/health` requests through 2026-09-01 return HTTP 200.
- `/api/v1/ci` repeatedly returns HTTP 200.
- Unauthenticated `/api/v1/ark/capabilities` returns 401 as expected.

## Completed / materially advanced
1. **Single Dino Cache Hub + sealed reveal flow** merged at current head; compatibility repair retained legacy shop-helper contracts.
2. Dino cache/shop work now includes cache service/extension, token issuance/auth, image/art support, DLC additions, SQLite probe, test harness, purchase tests, and live hub tests.
3. **Dynamic-config serving is deployed** as its own Railway service and proxies allowlisted ARK INI paths to Sentinel over Railway private networking.
4. ARK backend/server-control surfaces expanded significantly, including dynamic events, server controls, SFTP mod inventory, ArkShop maintenance/preflight, and MAP1 MySQL migration support.
5. Sentinel runtime is stable at process level: repeated periodic reconciliation cycles complete with no module-auto-provision failures.
6. ArkShop maintenance currently reports `maps=1 ready=1 drift=0 attention=0` for the map it sees.
7. Linked ARK rank reconciliation is healthy for four linked profiles/accounts (`changed=0 failed=0`).
8. MAP2 log tail confirms WBUI2 JSON parses successfully (`No Errors, Valid WBUI2 Json`), showing MAP2 remains reachable through at least the log-discovery path.

## P0 findings

### P0.1 — ARK cluster registry/metadata regressed from 2 maps to 1
Yesterday's accepted runtime reported `maps=2`. Current Sentinel repeatedly reports:
- `ARK cluster metadata ... maps=1`
- `ArkShop maintenance ... maps=1 ready=1`

At the same time current startup logs still contain an `ARK MAP2 newest tail`, so Astraeos/MAP2 has not simply vanished from every integration path.

**Impact**
- Cluster-wide economy, dynamic config, restart scheduling, mod monitoring, and cache behavior can silently operate on an incomplete map set.
- A green single-map readiness result is misleading for a two-map cluster.

**Required fix**
1. Treat expected cluster-map count/configured map IDs as an invariant.
2. Fail cluster readiness closed when a configured map is missing from registry metadata.
3. Reconcile registry bootstrap/persistence for `ARK_MAP2`/Astraeos and verify map IDs survive redeploys.
4. Add a regression test that boots both configured map prefixes and asserts both remain present after registry read/write/restart.

### P0.2 — ARK mod discovery regressed from 37 detected mods to 0
Yesterday's runtime detected 37 mods. Current Sentinel repeatedly reports:
`diskInventories=0 installedMods=0`.

**Impact**
- Sentinel cannot safely perform the planned automatic mod-update monitoring, changelog announcements, or critical-update restart decisions.
- Readiness may look green while the mod inventory is effectively blind.

**Required fix**
- Trace the new `ark-sftp-mod-inventory` path and its interaction with cluster metadata.
- Distinguish `zero mods installed` from `inventory unavailable/not scanned`; never encode discovery failure as a valid empty inventory.
- Add last-success timestamp, source/path, and error state to map readiness.
- Restore the known 37-mod inventory baseline before mod-update automation is considered accepted.

### P0.3 — Dynamic-config acceptance is incomplete until both maps are represented
The new public-facing dynamic-config proxy is deployed and healthy, but current cluster metadata only sees one map. The proxy allowlists `ark_gen1`, `ark_gen2`, and `ark_map2` INI paths, while its `/health` endpoint internally proxies only `ark_gen1.ini`.

**Impact**
- Railway can report the proxy healthy even if MAP2 dynamic config is missing/broken.
- This does not yet satisfy the owner-defined gate of dynamic configs being fully established before Forge continuation.

**Required fix**
- Add per-map config probes/readiness, including MAP2.
- Make health distinguish process health from content health.
- Validate preview -> validate -> publish -> fetch -> apply -> verify -> rollback for every configured map.
- Reject or degrade release when an expected map has no retrievable dynamic config artifact.

## P1 findings / regression risks

### P1.1 — `rebuild/nexus-0.1` is currently unprotected
GitHub reports `protected=false` and required status checks are not enforced on the active integration branch.

With 121 commits landing between audits and production auto-deploying from this branch, accidental direct pushes or merges can bypass release gates.

**Recommended fix:** enable branch rules requiring the relevant test/CI checks and prevent force pushes while preserving the approved release workflow.

### P1.2 — Warframe provider timeouts create repeated error bursts
Sentinel repeatedly times out after 10 seconds across Warframe news, events, alerts, arbitration, Nightwave, Void Trader, and Steel Path feeds.

**Recommended fix**
- Use one shared provider fetch/cache per reconciliation window instead of multiple sequential 10-second requests when the upstream dataset can be reused.
- Add circuit-breaker/backoff behavior and downgrade repeated upstream timeouts to compact degraded-provider summaries after the first classified error.

### P1.3 — Dynamic-config proxy health semantics are too narrow
`/health` maps directly to `/ark/dynamic/ark_gen1.ini`. This conflates process health with Gen1 content health and ignores MAP2.

**Recommended fix:** expose lightweight process health separately from per-map content readiness, or return a structured aggregate health result internally while retaining simple external compatibility if required.

### P1.4 — High-frequency reconciliation produces substantial log noise
Multiple panels/registries reconcile every minute while major auto-provision sweeps run roughly every five minutes and often take ~10–22 seconds.

**Recommended fix:** preserve idempotent reconciliation but emit state-change logs at info level and unchanged periodic results at debug/trace or sampled intervals. This will make production faults easier to spot.

### P1.5 — Forge deployment is healthy but older than the current Nexus branch delta
Forge's latest Railway deployment is from 2026-08-31T03:35Z while the Nexus integration branch advanced substantially afterward. This is not itself a defect because Forge is a separate service, but integration compatibility must be versioned explicitly.

**Recommended fix:** expose Forge API/schema version in Sentinel readiness and fail gracefully on unsupported versions rather than relying only on HTTP 200 health.

## P2 cleanup / feature opportunities
1. Add one authoritative **ARK Cluster Readiness** object containing expected maps vs discovered maps, RCON, SFTP, canonical paths, shop provider, DB sharing, dynamic-config artifact, WBUI2, mod inventory freshness, restart state, and last-good timestamps.
2. Add a **cluster invariant gate**: expected map count/map IDs must match before economy/cache/config mutations are allowed.
3. Add dynamic-config artifact hashes/version IDs so Sentinel can prove exactly which config each map fetched.
4. Add a mod-inventory `unknown/degraded` state rather than overloading an empty list.
5. Add Forge/Sentinel contract-version negotiation to the existing health/CI checks.
6. Reduce duplicated periodic Discord reconciliation logs and add a compact operational heartbeat summary.
7. Add a post-deploy smoke suite covering both ARK maps, dynamic config retrieval, shop-provider readiness, WBUI2 URL, mod inventory freshness, and build-worker health.

## Palworld / Nitrado server setup status
- **Nitrado-specific integration remains retired.** Do not restore provider-bound service IDs, tokens, or ownership assumptions.
- Palworld remains **provider-neutral**: use the game's/server's supported REST interface when it can be safely/private-routed; use RCON as fallback where supported; otherwise expose status/manual controls rather than inventing provider APIs.
- The reusable work from the earlier Nitrado exploration is the connection-profile abstraction, capability detection, credential isolation, and REST/RCON fallback model—not Nitrado-specific code.
- Recommended next implementation when Palworld returns to active work: a capability probe that records `rest`, `rcon`, or `manual` per server and routes Sentinel controls accordingly.

## Once Human deep configuration/setup status
- **Deep Once Human server-management integration remains retired** because rental Custom Server IDs are reused and are not safe durable ownership keys.
- Do not restore persistent ownership binding, automated server-admin actions, or configuration writes keyed only by Custom Server ID.
- Preserve game-neutral artifacts from the earlier deep setup work: configuration profiles, event/shop preset concepts, audit-log patterns, permission-gated admin UI patterns, and restart-required state modeling.
- Once Human community/news surfaces may remain independent of server-control integration; the Discord game category remaining present is not evidence that server automation should return.

## Updated build/release order
1. **Fix ARK two-map registry/metadata invariant.**
2. **Restore trustworthy mod inventory discovery (37-mod baseline or verified current equivalent).**
3. Complete shared MySQL/shop-provider convergence and cluster-economy acceptance.
4. Complete per-map dynamic-config end-to-end acceptance, including MAP2 and rollback.
5. Verify WBUI2 and restart/config behavior per map.
6. Add branch/release protection and post-deploy cluster smoke gates.
7. Then continue Nexus Forge expansion and deeper Sentinel integration.

## Owner input needed
- **No new product/architecture decision is required.**
- Owner/host input is only needed if automated read-only discovery cannot recover the missing MAP2 canonical configuration/SFTP paths or if the host must expose a path/permission Sentinel cannot inspect.
- No secrets should be requested in documentation or Discord; only the unresolved nonsecret path/capability information should be surfaced.

# Sentinel v2 production pre-deploy and rollback runbook

This runbook prepares a production cutover. It does **not** authorize a merge, Railway deploy, staged-patch acceptance, or live Dino Depot cryopod conversion.

## Candidate and rollback identities

- Production source branch before cutover: `rebuild/nexus-0.1`
- Observed production commit: `76d666b5b1abf8caacc976cfcc20fc192c589455`
- Observed successful Railway deployment: `c15e855a-88ec-4195-8a0d-905dd5835eec`
- Railway project: `e34e72bf-6ab7-437c-b55e-ef6aef586e4a`
- Railway production environment: `668aaf1d-a98c-4873-9e29-8c02aebb1ddb`
- Legacy Sentinel service: `a89ba9d3-e5e7-4e20-b1c8-1fad1ece331b` (`nexus-sentinal-0-1-test`)
- Prepared candidate branch: `sync/sentinel-v2-current-prod-r2` (PR #575)
- Candidate reviewed SHA: `6e302ed73809f24a86e6baac36fb1a29383ae9c7`

The candidate was synchronized with the production branch before this runbook was added. This preserves the five current production hotfix commits that contain the finalized RewardsAscended/Dino Cache delivery adapter, explicit Dino Depot fallback gate, acknowledgement/recovery safeguards, and associated tests.

## Read-only evidence snapshot — 2026-09-10

- PR #575 was open, draft, unmerged, and mergeable at the candidate SHA above. Nexus Rebuild CI run #1709 (`34511807330`) completed successfully on that exact head.
- The PR also carries a failed Cloudflare Workers deployment report for `khaos-nexus-dev`. GitHub's combined commit-status wrapper returned no statuses; that does not establish that every integration passed. Determine whether the failure applies to the Sentinel release before proceeding.
- Railway reported the current Sentinel deployment above as SUCCESS, together with Hub, Postgres, ARK dynamic config, and ARN.
- All eight inspected duplicate deployments newer than the active deployment were REMOVED. Do not create another redeploy to clear an already-removed queue.
- Runtime logs through 18:20:26Z report Sentinel online and normal panel reconciliation. They also report MAP2 ArkShop drift, one unavailable config, and zero ArkShop maintenance mutations. Deployment SUCCESS is not proof of complete ARK readiness.
- The former rollback deployment `f0716d0d-ccda-4c3f-b5c2-778a1d8ffe61` was previously observed REMOVED. It must not be used as a verified rollback target.
- The current successful deployment is a replacement rollback **candidate** only. Confirm its recoverability, capture service configuration, and complete read-only health checks before setting rollback verification true or recording a verification timestamp.
- The Railway status response returned null for both staged changes and their count. Treat staged-change state as unknown, not as a verified zero. Resolve this inspection gap before any environment-wide acceptance.
- The owner has explicitly approved deploying what is ready, scoped to #575 in the deployment handoff. This snapshot does not revoke that approval or extend it to new commits, #574, service restructuring, unrelated staged changes, or Dino Depot conversion.

This snapshot is historical evidence, not a durable health guarantee. Recheck the candidate, production identity, queue, staged changes, and rollback availability immediately before deployment. Coordinate with the existing deployment work to avoid competing merges or redeploys.

## Hard gates before deployment

- [ ] Candidate PR is mergeable and remains based on the current production head.
- [ ] Nexus Rebuild CI is fully green for the exact candidate head SHA.
- [ ] No required production hotfix exists only on `rebuild/nexus-0.1` and outside the candidate ancestry.
- [ ] Sentinel v2 cutover readiness reports database healthy.
- [ ] ARK health-equivalence proof is eligible.
- [ ] Read-only ARK RCON proof is eligible.
- [ ] Quarantined Sentinel dead letters are zero and the dead-letter store is inspectable.
- [ ] Mutation safety remains fail-closed/dry-run for the validation phase.
- [ ] Deployment and rollback evidence identify distinct valid commits and the known-good Railway deployment.
- [ ] Rollback verification timestamp is fresh at approval time.
- [ ] Railway staged changes are explicitly inspected and any unrelated patch is resolved before deployment. **Do not accept changes wholesale.** A null or unavailable count is not evidence of a clean environment.
- [ ] Owner explicitly approves the production merge/deployment after all previous gates are green.

## Railway staged-patch rule

Do not use unrelated staged changes as the vehicle for the Sentinel v2 cutover. If a patch is present, review or discard it separately in Railway before production deployment. Recreate only intentional Sentinel cutover changes from a clean environment state after owner approval.

The desired eventual canonical service configuration is:

- Dockerfile: `Dockerfile.sentinel`
- Sentinel entry point: `src/railway/sentinel-service.cjs`
- corrected `NEXUS_SENTINEL_*` variables first, with legacy aliases retained for one migration window
- health endpoint preserved and verified
- worker responsibilities separated according to issue #568 rather than silently added to the legacy process

Do not rename/remove the legacy service, generated domain, legacy variables, or compatibility files in the initial cutover step. Preserve them until v2 has passed post-deploy verification.

## Dino Cache deployment verification

Before approval, verify on the exact candidate head:

1. `src/sentinel/rewards-ascended-delivery.cjs` exists and `rewardsascended` remains the default Dino Cache delivery backend.
2. `NEXUS_DINO_CACHE_DINODEPOT_FALLBACK` remains explicit opt-in; no implicit fallback is allowed.
3. RewardsAscended delivery keeps `GiveInCryoPod: true`, records a stable per-order reward identity, backs up and verifies its config update, reloads before reward send, and treats ambiguous sends as unconfirmed rather than retry-safe success.
4. `ark-dino-box-delivery-worker.cjs` preserves `DINO_ACKNOWLEDGED` protection so an acknowledged creature is never automatically sent again.
5. Existing saddle acknowledgement/reconcile behavior remains in place.
6. Do not use a real player order as a deployment healthcheck unless the owner separately approves a controlled delivery test.

## Dino Depot automatic cryopod conversion

Keep `CryosAutoConvertToDinoballs=False` during the Sentinel deployment. Cryopod conversion is a separate, explicitly approved post-cutover action so its blast radius is not combined with the Sentinel runtime change.

The prepared helper:

- defaults to `enabled=false` and `dryRun=true`;
- changes only `[DinoDepot] CryosAutoConvertToDinoballs`;
- refuses a live write unless `confirmLive=true` is also supplied;
- fails closed on conflicting duplicate or invalid existing values;
- preserves unrelated Dino Depot keys and other INI sections;
- relies on the ARK config manager's timestamped `NexusBackups` backup and post-write verification;
- does not scan, delete, rewrite, import, or bulk-migrate Dino Depot storage.

Dino Depot performs conversion when vanilla cryopods enter player inventory. Turning the setting back off prevents future automatic conversions; it does not claim to reverse items that Dino Depot has already converted. Never remove the mod or overwrite stored Dinoballs as a rollback mechanism.

## Approval-time deployment sequence

Only after explicit owner approval:

1. Confirm candidate SHA and CI have not changed since approval.
2. Reconfirm the known-good legacy Railway deployment and commit are still available for rollback.
3. Ensure the unrelated staged Railway patch is no longer pending.
4. Record current Railway service config and variable names before any change.
5. Merge the explicitly approved candidate into the production source branch using the reviewed SHA.
6. Apply only the reviewed canonical Sentinel Railway configuration changes; do not bundle Dino Depot conversion enablement.
7. Start v2 with mutations disabled/dry-run until health/readiness and shadow gates are verified.
8. Verify `/health/live`, `/health/ready`, authenticated cutover readiness, Postgres, Discord gateway, Hub connectivity, ARK read health, and read-only RCON observation.
9. Verify Dino Cache worker startup/config without forcing a live reward delivery.
10. Enable any v2 mutation capability only as an independent, auditable step after the owner-approved cutover criteria are met.

## Sentinel rollback

If health, Discord, database, ARK observation, or worker behavior fails after cutover:

1. Disable v2 mutations first.
2. Stop/disable the v2 worker path so it cannot contend with legacy jobs.
3. Restore the production source/configuration to the rollback commit and deployment explicitly verified and recorded immediately before cutover. The replacement candidate is commit `76d666b5b1abf8caacc976cfcc20fc192c589455`, deployment `c15e855a-88ec-4195-8a0d-905dd5835eec`; do not assume SUCCESS alone proves recoverability. Never select the removed historical deployment.
4. Restore the legacy Dockerfile/start-command compatibility path if it was changed.
5. Verify `/health`, Discord gateway, Postgres, ARK connectivity, and Dino Cache queue state before re-enabling legacy mutations.
6. Do not retry any order in an ambiguous/unconfirmed delivery state without inventory reconciliation.
7. Preserve Sentinel audit/dead-letter evidence for diagnosis.

## Dino Depot conversion rollback

If conversion is separately approved later and must be stopped:

1. Stop moving additional vanilla cryopods into player inventories during diagnosis.
2. Restore the exact timestamped `GameUserSettings.ini` backup through the confirmed backup-restore path, or explicitly set `CryosAutoConvertToDinoballs=False` through the guarded live configuration path.
3. Restart the affected ARK server if required for the INI change to take effect.
4. Verify the setting is false on every affected map.
5. Verify ordinary Dino Depot capture/release using non-critical test inventory.
6. Treat already-converted Dinoballs as existing player data; do not bulk-delete, overwrite, or attempt an automated reverse conversion.

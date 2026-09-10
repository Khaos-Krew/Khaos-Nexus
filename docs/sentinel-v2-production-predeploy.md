# Sentinel v2 production pre-deploy and rollback runbook

This runbook prepares a production cutover. It does **not** authorize a merge, Railway deploy, staged-patch acceptance, or live Dino Depot cryopod conversion.

## Candidate and rollback identities

- Production source branch before cutover: `rebuild/nexus-0.1`
- Known-good production commit: `0e6ad1419ef52f76416547c37b98882667ca3f84`
- Known-good Railway deployment: `f0716d0d-ccda-4c3f-b5c2-778a1d8ffe61`
- Railway project: `e34e72bf-6ab7-437c-b55e-ef6aef586e4a`
- Railway production environment: `668aaf1d-a98c-4873-9e29-8c02aebb1ddb`
- Legacy Sentinel service: `a89ba9d3-e5e7-4e20-b1c8-1fad1ece331b` (`nexus-sentinal-0-1-test`)
- Prepared candidate branch: `sync/sentinel-v2-current-prod`

The candidate was synchronized with the production branch before this runbook was added. This preserves the five current production hotfix commits that contain the finalized RewardsAscended/Dino Cache delivery adapter, explicit Dino Depot fallback gate, acknowledgement/recovery safeguards, and associated tests.

## Hard gates before owner approval

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
- [ ] The existing Railway staged patch is resolved before deployment. **Do not accept it wholesale.** The environment currently contains a large pre-existing staged patch unrelated to this isolated candidate.
- [ ] Owner explicitly approves the production merge/deployment after all previous gates are green.

## Railway staged-patch rule

Do not use the existing staged patch as the vehicle for the Sentinel v2 cutover. Review or discard that patch separately in Railway before production deployment. Recreate only intentional Sentinel cutover changes from a clean environment state after owner approval.

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
3. Restore the production source/configuration to known-good commit `0e6ad1419ef52f76416547c37b98882667ca3f84` and Railway deployment identity `f0716d0d-ccda-4c3f-b5c2-778a1d8ffe61` (or a newer explicitly verified known-good legacy deployment if recorded before cutover).
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

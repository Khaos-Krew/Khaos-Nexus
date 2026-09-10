# Dino Depot automatic cryopod conversion rollout

## Scope

Dino Depot exposes `CryosAutoConvertToDinoballs` in the `[DinoDepot]` section of `GameUserSettings.ini`. Dino Depot's published changelog describes this behavior as converting vanilla cryopods when they are placed into a player's inventory.

Sentinel must treat this as an opt-in migration aid, not as an unattended maintenance task.

## Safe default

- Desired initial state: `CryosAutoConvertToDinoballs=False`.
- Preview changes first with `configureCryopodAutoConversion({ prefix, enabled, dryRun: true })`.
- No live write is possible through the helper unless both `dryRun: false` and `confirmLive: true` are supplied.
- The existing ARK config manager creates a timestamped `NexusBackups` copy before any live `GameUserSettings.ini` write and verifies the resulting file after upload.
- Conflicting duplicate or invalid existing `CryosAutoConvertToDinoballs` values fail closed instead of being normalized silently.

## Data-preservation boundary

This setting does not instruct Sentinel to enumerate, rewrite, delete, import, or migrate stored dinos. Sentinel changes one INI key only. Existing `[DinoDepot]` settings and unrelated INI sections are preserved by the planner and covered by regression tests.

Dino Depot performs the actual item conversion when a vanilla cryopod enters player inventory. Existing Dinoballs are not rewritten by this Sentinel configuration path. Existing vanilla cryopods that remain outside player inventory are not proactively touched by Sentinel.

Important: once Dino Depot itself has converted a specific vanilla cryopod into a Dinoball, reverting the INI setting only stops future automatic conversions; it must not be represented as converting already-converted items back into vanilla cryopods.

## Pre-enable procedure

1. Confirm all intended ARK maps have the same compatible Dino Depot version installed and loaded.
2. Capture a current `GameUserSettings.ini` backup for every map.
3. Run the conversion helper in dry-run mode for every enabled map and review the exact resulting INI.
4. Verify the only semantic change in `[DinoDepot]` is `CryosAutoConvertToDinoballs=False -> True` (or insertion of the key when absent).
5. Verify no duplicate/conflicting conversion key exists.
6. Record the backup path returned by the config manager for rollback.
7. Use a controlled test player with a non-critical vanilla cryopod first.
8. Confirm the converted Dinoball contains the expected creature and can be released normally before broader use.
9. Do not perform the live enablement until the owner explicitly approves it.

## Rollback

Configuration rollback:

1. Stop further test movement of vanilla cryopods into player inventories.
2. Restore the exact timestamped `GameUserSettings.ini` backup with `restoreCryopodConversionBackup({ prefix, backup, confirmLive: true })`, or set the managed key back to `False` through the confirmed live path.
3. Restart the affected ARK server if required for the INI change to take effect.
4. Verify `CryosAutoConvertToDinoballs=False` on every map.
5. Confirm ordinary Dino Depot capture/release still works.

Item-state rollback boundary:

- Do not delete the Dino Depot mod or remove stored Dinoballs as a rollback mechanism.
- Do not overwrite or bulk-regenerate existing Dino Depot storage.
- Already converted items require in-game verification/recovery appropriate to Dino Depot; the configuration rollback intentionally does not attempt a destructive reverse conversion.

## Source

Dino Depot CurseForge changelog for release 119 documents the conversion feature and the `CryosAutoConvertToDinoballs` setting:
https://www.curseforge.com/ark-survival-ascended/mods/dino-depot/files/5682365

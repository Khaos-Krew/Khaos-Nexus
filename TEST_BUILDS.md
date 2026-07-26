# Khaos Nexus Owner-Test Builds

Every owner-test milestone is preserved as a dedicated Git branch and a separately named Windows ZIP. New development continues without rewriting earlier checkpoints.

## v0.14.4 — Verified Windows compatibility baseline

- Source branch: `test/v0.14.4-owner-verified`
- Source commit: `2c6d7e4ec443156df1fc3c314aa9301ab62ae828`
- Test package: `Khaos-Nexus-v0.14.4-brand-renderer-bypass.zip`
- Package SHA-256: `bfbd81acdf607fb30bda55c4d97daaee5090d0056c62f88519380cbb70dc8836`
- Owner status: portable build opened and appeared fully functional on the target Windows PC.

## v0.15.0 — Server Scheduler

- Source branch: `test/v0.15.0-server-scheduler`
- Source commit: `b8f9743461773056fa677b64684fc53e5f7ad461`
- Test package: `Khaos-Nexus-v0.15.0-server-scheduler.zip`
- Package SHA-256: `0a6c5cd9362aeabb79c8ac2b5ddddaaba485793a32cf83e4542f212f017b091c`
- Owner status: awaiting live-device scheduler testing.

## v0.16.0 — Players & Moderation

- Source branch: `test/v0.16.0-players-moderation`
- Application source commit: `789246cde7f089c26ce526714e04cd276203eb16`
- Packaged checkpoint commit: `373537c3df3af10e9b451148472d92303e4d796f`
- Test package: `Khaos-Nexus-v0.16.0-players-moderation.zip`
- Package SHA-256: `48d4da00471b6c66ad93c7df7626aae352ba4a89a68ef61124960de6829078c8`
- Owner status: awaiting live-device player-list and moderation testing.

## v0.17.0 — Pterodactyl Hosted Server Control

- Source branch: `test/v0.17.0-pterodactyl-control`
- Application source commit: `ab5d7ac0b37f5be20cac115d65104fb926926b99`
- Packaged checkpoint commit: `0deee6fb0e7ae87089dad7b9e050f326a79df65e`
- Test package: `Khaos-Nexus-v0.17.0-pterodactyl-control.zip`
- Package SHA-256: `c065129cbe730f9e0bae01fd8cfe9e8d1e30e37375996a9f21c4845ddb582952`
- Owner status: portable build works on the target Windows PC; button-reporting gaps were found.

## v0.17.1 — Button & UI Action Error Reporting

- Source branch: `test/v0.17.1-button-error-reporting`
- Application source commit: `be1e665f3990844a243270ecca982cfd452c223f`
- Packaged checkpoint commit: `457541a4588dc837b3b3c4c60d80d58fa2a524ed`
- Test package: `Khaos-Nexus-v0.17.1-button-error-reporting.zip`
- Package SHA-256: `5d4a8bf78f8dc3cac395316ef56c7130a14006fb5ca88eec35cedc30ee9d18e5`
- Owner status: exposed a pre-login diagnostics authorization loop.

## v0.17.2 — Pre-login Diagnostics Authorization Fix

- Source branch: `test/v0.17.2-prelogin-diagnostics`
- Application source commit: `ef0ad348c055e4b9de7475dea3e402a8400c7eb1`
- Packaged checkpoint commit: `5ee18be2f3af83cfc8ae1a68aef45263ad9649c5`
- Test package: `Khaos-Nexus-v0.17.2-prelogin-diagnostics-fix.zip`
- Package SHA-256: `1066f23460ca798f00a8049405162bc7c882df435f10f38f0f12742b81fee76d`
- Owner status: data and configuration loading are the last known-good baseline for the v0.18 investigation.

## v0.17.3 — Scheduled Automatic Error Batches

- Source branch: `test/v0.17.3-scheduled-error-batches`
- Application source commit: `3cd1217f64c80a2f948fc1fce58d80c594c40a91`
- Packaged checkpoint commit: `93f2814dc67951dcc272b12677455d74fe6517a6`
- Test package: `Khaos-Nexus-v0.17.3-scheduled-error-batches.zip`
- Package SHA-256: `bd41753870b7187b5894adabc7356f5db5fd2a6246193dbece80ade2a72376ee`
- Owner status: awaiting verification of the five-minute startup batch and maintained thirty-minute cycle.

## v0.18.0 — Branded Startup Interaction Lock

- Source branch: `test/v0.18.0-startup-splash`
- Application source commit: `f9b44a7963a2dbf0858f82a96977959b1a2236ca`
- Packaged checkpoint commit: `38915140a352a689fae734738dbfcdd0d5110f7d`
- Test package: `Khaos-Nexus-v0.18.0-startup-splash.zip`
- Package SHA-256: `95b26459740a0ded56066d151485c7fa9118d9e62fe4e5715e346b497549d9c3`
- Owner status: failed startup testing; prior configuration did not appear and access control displayed too early.

## v0.18.1 — Startup Restoration & Configuration Recovery

- Source branch: `test/v0.18.1-startup-restore`
- Application source commit: `a1459526dc3cf281d144ba615da3cab2191499fb`
- Packaged checkpoint commit: `ae7e2956b0830cf3b6fd193070d20a49e5146d19`
- Test package: `Khaos-Nexus-v0.18.1-startup-restore.zip`
- Package SHA-256: `02311b3c79ec49a00bbe14fbcf502f9be47308a2c09caafb2f09cd97675b5abf`
- Owner status: preload stopped before exposing `window.khaos`, creating a false Access Recovery lockout.

## v0.18.2 — Preload Bridge & False Lockout Fix

- Source branch: `test/v0.18.2-preload-bridge-fix`
- Application source commit: `7b95c0145940ad0145d262e1603f055f62806954`
- Packaged checkpoint commit: `ada5b35f3bf92fc7836afddfed2b56296c8f3464`
- Test package: `Khaos-Nexus-v0.18.2-preload-bridge-fix.zip`
- Package SHA-256: `39bacea6c80dc1ecd15abed46f0e13b9144c28b42e138909281e42edb1ea5e74`
- Owner status: configuration and data from v0.17.2 still failed to load.

## v0.18.3 — Stable Startup Health & v0.17 Profile Recovery

- Source branch: `test/v0.18.3-stable-startup-health`
- Application source commit: `adfa11062729a4a337b7e4a0200ee47734f2072b`
- Packaged checkpoint commit: `cfcecfb526ebbc8551919bf79b84811d4fba04a3`
- Test package: `Khaos-Nexus-v0.18.3-stable-startup-health.zip`
- Package SHA-256: `dd702644267c912b68307723488e29cc0bc3d0df0a1297150108b739a71caf16`
- Owner status: awaiting live-device verification.
- Main changes: rebuilt from the v0.17.3 data-loading foundation; removed the v0.18 heuristic migration layer; uses the canonical v0.17 data path; transactionally recovers a recorded v0.18 pre-migration backup only when the current profile is empty, invalid, or clearly less complete; leaves live Chromium cache directories untouched; shows a dedicated startup window first for at least 30 seconds; verifies config JSON, retained module data, write access, secure storage, loaded configuration counts, renderer IPC, and serialized modules before revealing the main interface; Access Recovery remains hidden until the health gate releases the desktop.

## Test-build policy

1. Each milestone receives a unique semantic version.
2. The exact source commit is preserved on a `test/vX.Y.Z-*` branch.
3. Installer and portable executables are retained in a uniquely named ZIP.
4. Package SHA-256 values are recorded here and in the validation pull request.
5. Stable in-app publication waits for owner testing.
6. Later development never overwrites a previous versioned test package.

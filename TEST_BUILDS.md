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
- Owner status: failed live-device startup at 68%; the startup splash was incorrectly enrolled in the main renderer heartbeat watchdog, and the gate waited indefinitely for optional module completion.

## v0.18.4 — Startup Splash Watchdog & Release Fix

- Source branch: `test/v0.18.4-startup-watchdog-fix`
- Application source commit: `205606b5b5c76793bc116a139f8e89d2e3db26a4`
- Packaged checkpoint commit: `cf81c80e1509a2afef34c6f522459b405bca518e`
- Test package: `Khaos-Nexus-v0.18.4-startup-watchdog-fix.zip`
- Package SHA-256: `3ef7c9685c1d6b248de3bdfe6ed427b11e63622d6bf9ba502142901e226ddc76`
- Owner status: failed live-device startup at 94%; data and protected values loaded, but the 75-second timeout fired because the release fallback still depended on Application Monitor emitting `monitor-ready`.

## v0.18.5 — Independent Verified Release Gate

- Source branch: `test/v0.18.5-release-gate-fix`
- Application source commit: `168b31fb8cc97f23136a3d060a5a9e167dbc1867`
- Packaged checkpoint commit: `f419371179c008051286c3ce3247fa55c24e62ca`
- Test package: `Khaos-Nexus-v0.18.5-release-gate-fix.zip`
- Package SHA-256: `98d48e8587aa32b4d7555e3768cdc64bccdd713bc0fd3812c18da9fc429e49cf`
- Owner status: failed live-device startup at 94%; the base-interface verifier could attach before `loadFile()` started, mark itself installed, and exhaust its only attempt against an empty renderer.

## v0.18.6 — Deterministic Startup & Safe Two-Step Updates

- Source branch: `test/v0.18.6-startup-update-safety`
- Application source commit: `af6be1b966c94e0d03da3cb0126bead32f54715b`
- Packaged checkpoint commit: `647a97740397f665c233c8a5b97e34b723532a12`
- Test package: `Khaos-Nexus-v0.18.6-startup-update-safety.zip`
- Package SHA-256: `84d30049d930bbe9c786f1435b685d9fba7eb32ff8cd431da6325a585e26f8b3`
- Owner status: failed live-device startup at 94%; the base-interface acknowledgement was not retained, so the core `rendererModulesReady` prerequisite remained false and the 75-second timeout fired.
- Main changes: explicit Download Update and Install & Restart steps; mandatory verified `pre-update` backup; initial retry-based base-interface fallback.

## v0.18.7 — Direct Startup Gate & Retained Release Diagnostics

- Source branch: `test/v0.18.7-direct-startup-gate`
- Application source commit: `e57e01c6f8f830fc91d42d3661bb3a92afb410d6`
- Packaged checkpoint commit: `b277e19e102ccadf7d2a8be57719a367e0753220`
- Test package: `Khaos-Nexus-v0.18.7-direct-startup-gate.zip`
- Package SHA-256: `61fd9f94c37bc2f74fbcbae0432e6c1f38e9ae4ef2776a788990b2033b12ce44`
- Owner status: failed live-device startup at 94%; the separate BrowserWindow/preload release helper did not produce its expected retained diagnostic stage.
- Main changes: direct readiness acknowledgement from `main/preload.cjs`; strict rejection of the startup splash as a readiness sender; a main-document backup verifier; 15-second optional-module grace; retained release diagnostics; Discord desktop sign-in explicitly labeled optional; safe two-step updater and mandatory pre-update backup retained.

## v0.18.8 — Main-Process Core Startup Release

- Source branch: `test/v0.18.8-core-startup-release`
- Application source commit: `148fb9aa5557aac9a8c6f7db6fe43a0be05485a5`
- Packaged checkpoint commit: `5f985953415c217a49ea9ace9421ed9a9c67d313`
- Test package: `Khaos-Nexus-v0.18.8-core-startup-release.zip`
- Package SHA-256: `ca637013bed208082aeccfadd7d145990a7a7e397f080f0d3a08140e2a2b72bf`
- Owner status: failed live-device startup at 68%; configuration and storage passed, but the protected renderer bridge never acknowledged.

## v0.18.9 — Sandboxed Main Preload Fix

- Source branch: `test/v0.18.9-sandbox-preload-fix`
- Application source commit: `6fd3f0c1d9218bc177db5918bd23d6b3d0f8b3d5`
- Packaged checkpoint commit: `472129aedb00dadd1d9f96714690f3d6b6fd6e6b`
- Test package: `Khaos-Nexus-v0.18.9-sandbox-preload-fix.zip`
- Package SHA-256: `710f75a1780bb8b64a946fd7431c42d1d842ee44775de48565653ac4065e8490`
- Owner status: awaiting live-device verification; fixed the sandboxed preload's unsupported local CommonJS import and added retained preload-error diagnostics.

## v0.18.10 — Portable Sidecar Diagnostics

- Source branch: `test/v0.18.10-portable-sidecar-diagnostics`
- Application source commit: `00f0254c8232100ca230969770340acf7c3afaa3`
- Packaged checkpoint commit: `d39eb05b0b3aef7d2e5f322a313929c4124cb07d`
- Test package: `Khaos-Nexus-v0.18.10-portable-sidecar-diagnostics.zip`
- Package SHA-256: `c0734fd4eb8ab9b49946e4e2908ba7b24bbd44a082457e1d11563f5de846b1ec`
- Owner status: fully loaded successfully on the target Windows PC. Startup released normally after approximately 30.46 seconds.
- Main changes: immediately creates visible portable sidecar logs and diagnostics beside the executable while continuing to use the canonical AppData configuration profile.

## v0.18.11 — Independent Pane Scrolling

- Source branch: `test/v0.18.11-scroll-layout-fix`
- Application source commit: `2891db3a3abc3b9b0e1f7580d824c3179cf71825`
- Packaged checkpoint commit: `836ab8246cbd5d9d48449bdd6319d783156e660f`
- Test package: `Khaos-Nexus-v0.18.11-scroll-layout-fix.zip`
- Package SHA-256: `b2c79828c634890998c87fdd4f8a6e4a10006e2dcbc1607566fd18bab70089b6`
- Owner status: verified fully working on the target Windows PC, including startup and scrolling.
- Main changes: independent vertical scrolling for the sidebar and workspace in software and rich-brand modes; nested logs and diagnostics retain their own scrolling.

## v0.18.12 — Validation-Only Version Collision

- Source branch: `test/v0.18.12-menu-release-patch`
- Application source commit: `2300277da0b71dca6f836bdd5259c3d31778caff`
- Packaged checkpoint commit: `84ab96a9298fc05641fb9a9c454f762528bd0491`
- Validation package: `Khaos-Nexus-v0.18.12-menu-release-patch.zip`
- Package SHA-256: `9fbe774b6f4b597f8afb317988ee217e044dcf7083740896939cfbaa7c3ff55e`
- Status: CI and Windows packaging passed, but publication was intentionally cancelled because Git tag `v0.18.12` already pointed to the older stable-release-workflow commit `7475b173b5191c4ba637c2f76164b0d4cf69bbfb`. No menu patch was published under this version.

## v0.18.13 — Grouped Navigation & Stable In-App Release

- Source branch: `test/v0.18.13-menu-release-patch`
- Application source commit: `92249beddcd35073e2e3885d7713f0db8f1fa4eb`
- Packaged checkpoint commit: `61d3e7a6e54a6bc3d78ee6ee368df95efa310403`
- Test package: `Khaos-Nexus-v0.18.13-menu-release-patch.zip`
- Package SHA-256: `79df069d5ca96c67fe60d0d6866a29ba4dd137da78be8bab6746ad8592c5cb22`
- Owner status: awaiting in-app update and live navigation verification.
- Main changes: Command Center remains pinned; searchable collapsible Servers, Discord & Community, Automation, Modules & Tools, and System groups; one open group at a time; dynamic classification of injected future pages; duplicate navigation suppression; preserved scrolling, startup, portable diagnostics, and mandatory pre-update backup.

## Test-build policy

1. Each milestone receives a unique semantic version.
2. The exact source commit is preserved on a `test/vX.Y.Z-*` branch.
3. Installer and portable executables are retained in a uniquely named ZIP.
4. Package SHA-256 values are recorded here and in the validation pull request.
5. Stable in-app publication waits for validation and a collision-free semantic version.
6. Later development never overwrites a previous versioned test package.

# Khaos Nexus Owner-Test Builds

Every owner-test milestone is preserved as a dedicated Git branch and a separately named Windows ZIP. New development continues on the active integration branch without rewriting earlier checkpoints.

## v0.14.4 — Verified Windows compatibility baseline

- Source branch: `test/v0.14.4-owner-verified`
- Source commit: `2c6d7e4ec443156df1fc3c314aa9301ab62ae828`
- Test package: `Khaos-Nexus-v0.14.4-brand-renderer-bypass.zip`
- Package SHA-256: `bfbd81acdf607fb30bda55c4d97daaee5090d0056c62f88519380cbb70dc8836`
- Owner status: portable build opened and appeared fully functional on the target Windows PC.
- Main change: software-renderer-safe startup with the expensive optional brand renderer bypassed.

## v0.15.0 — Server Scheduler

- Source branch: `test/v0.15.0-server-scheduler`
- Source commit: `b8f9743461773056fa677b64684fc53e5f7ad461`
- Test package: `Khaos-Nexus-v0.15.0-server-scheduler.zip`
- Package SHA-256: `0a6c5cd9362aeabb79c8ac2b5ddddaaba485793a32cf83e4542f212f017b091c`
- Owner status: awaiting live-device scheduler testing.
- Main changes: compact dashboard, recurring saves, warning sequences, safe shutdown, host-managed restart verification, Discord reports, cancellation, and execution history.

## v0.16.0 — Players & Moderation

- Source branch: `test/v0.16.0-players-moderation`
- Application source commit: `789246cde7f089c26ce526714e04cd276203eb16`
- Packaged checkpoint commit: `373537c3df3af10e9b451148472d92303e4d796f`
- Test package: `Khaos-Nexus-v0.16.0-players-moderation.zip`
- Package SHA-256: `48d4da00471b6c66ad93c7df7626aae352ba4a89a68ef61124960de6829078c8`
- Owner status: awaiting live-device player-list and moderation testing.
- Main changes: cross-server connected-player view, server/name/game filtering, automatic refresh, short-lived moderation tokens, Operator kick, Owner ban, required reasons, and local moderation history without retained account IDs.

## v0.17.0 — Pterodactyl Hosted Server Control

- Source branch: `test/v0.17.0-pterodactyl-control`
- Application source commit: `ab5d7ac0b37f5be20cac115d65104fb926926b99`
- Packaged checkpoint commit: `0deee6fb0e7ae87089dad7b9e050f326a79df65e`
- Test package: `Khaos-Nexus-v0.17.0-pterodactyl-control.zip`
- Package SHA-256: `c065129cbe730f9e0bae01fd8cfe9e8d1e30e37375996a9f21c4845ddb582952`
- Owner status: portable build works on the target Windows PC; several button failures were observed but were not retained by Application Monitor.
- Main changes: encrypted Client API keys, HTTPS enforcement, provider testing, server discovery, CPU/memory/disk/network/uptime cards, short-lived action tokens, Operator start/restart/stop, Owner-only emergency kill, and local provider action history.

## v0.17.1 — Button & UI Action Error Reporting

- Source branch: `test/v0.17.1-button-error-reporting`
- Application source commit: `be1e665f3990844a243270ecca982cfd452c223f`
- Packaged checkpoint commit: `457541a4588dc837b3b3c4c60d80d58fa2a524ed`
- Test package: `Khaos-Nexus-v0.17.1-button-error-reporting.zip`
- Package SHA-256: `5d4a8bf78f8dc3cac395316ef56c7130a14006fb5ca88eec35cedc30ee9d18e5`
- Owner status: awaiting live-device verification of failed-button retention and reporting.
- Main changes: centralized failed IPC capture, active page/button/action context, redacted local persistence, repeat counting, Health Monitor routing, and a copyable UI Action Errors panel in Application Monitor.

## Test-build policy

1. Each milestone receives a unique semantic version.
2. The exact source commit is preserved on a `test/vX.Y.Z-*` branch.
3. Installer and portable executables are retained in a uniquely named ZIP.
4. Package SHA-256 values are recorded here and in the draft pull request.
5. Stable in-app publication waits for owner testing.
6. Later development never overwrites a previous versioned test package.

# Android Companion Production Hold

**Decision:** ADR-008  
**Source issue:** #101  
**Effective:** July 31, 2026  
**Status:** Paused by Owner directive; preserved for possible future resumption

## Scope of the hold

The hold applies to all active Android Companion and desktop Mobile Gateway production work, including:

- Android feature development and toolchain repair;
- Mobile Gateway feature development or activation;
- APK construction for Owner testing, signing, publication, or distribution;
- real-device testing and Owner test-session requests;
- Android release preparation and promotion;
- work whose only purpose is to make Android checks pass on an unrelated desktop or module pull request.

The hold is not a rejection or deletion decision. Existing implementation and evidence remain part of Khaos Nexus history.

## Preserved state

The following must remain intact:

- `android/**` source and tests;
- Mobile Gateway source, tests, security contracts, and migration history;
- branches and pull requests, including PR #77 at `125a01270672be7bb0a2d99189498d3e45fa7c54`;
- the integrated PR #81 state at `1cff97f7c1cbf12b2cb6aea04cb9e4d3dc971dae`;
- prior APK signature, checksum, CI, pairing, certificate-pinning, request-signing, replay-protection, revocation, and Android Keystore evidence;
- workflow definitions and signing configuration references without exposing credentials.

No code, branch, workflow, evidence, signing identity, certificate contract, pairing contract, key-storage behavior, or security boundary may be deleted, weakened, rewritten, or treated as obsolete merely because production is paused.

## Reversible desktop exclusion mechanism

Active Windows candidates must use an off-by-default runtime policy.

The implementation contract is:

1. `KHAOS_NEXUS_MOBILE_GATEWAY_ENABLED` is the explicit activation gate.
2. Missing, empty, `0`, `false`, or any value other than `1` means disabled.
3. Release, Owner-test, and development candidates built while ADR-008 is active must not set the value to `1`.
4. When disabled, the desktop must not install Mobile Gateway registry promotion, gateway IPC handlers, security wrappers, listeners, pairing endpoints, timers, or navigation routes.
5. The module catalog and user-facing surfaces must report **Paused / unavailable by Owner directive**, not implemented, available, broken, or awaiting validation.
6. Saved enablement from an older installation must not reactivate the gateway while the production policy is disabled.
7. Dormant source may remain packaged only when it is unreachable and does not open a listener, advertise pairing, or expose an IPC surface.

A future authorized resumption can reuse the preserved implementation by changing the policy through a new ADR and targeted implementation handoff. No security bypass or deletion is required.

## Android CI policy during the hold

Android CI must not gate unrelated desktop or module work.

During the hold:

- automatic `pull_request` and broad `agent/**` push triggers are removed from the Android workflow;
- the Android workflow is retained as `workflow_dispatch` only;
- no Android workflow run, APK build, signing operation, or artifact upload is authorized without a future resumption issue and exact approved baseline;
- unrelated pull requests use normal desktop/module CI and are not failed because Gradle, Kotlin, Compose, Android SDK, signing, or APK tasks did not run;
- Android-specific dependency and plugin defect #100 is deferred, not repaired as general repository maintenance;
- a future resumption may restore path-scoped triggers covering `android/**`, Mobile Gateway runtime files, the Android workflow, and Android-owned dependency files.

When Android CI is restored, Android-owned changes remain strictly validated; the policy does not make Android failures non-blocking for Android work.

## Active issue and pull-request disposition

- **Issue #89:** retained open and paused as preserved real-device validation scope. It is not a desktop release blocker and no Owner test may be requested.
- **Issue #100:** closed as deferred/not planned under the hold. Its evidence remains the starting point if resumption later authorizes toolchain repair.
- **PR #77:** retained as a preserved Android checkpoint, not an active integration or release candidate. The branch must not be deleted.
- **PR #81 and descendants:** remain valid for non-Android work only after the Mobile Gateway exclusion and Android CI scope correction are applied and evidenced.
- **PR #98 / issue #94:** Android failure is not attributable to D&D and must not block D&D once the hold implementation is applied.

## Product and release presentation

While the hold is active:

- the public feature registry and generated README classify Android Companion and Mobile Gateway as **Paused**, not Available or In Development;
- Update Center metadata and Windows release notes state that Android Companion and Mobile Gateway are excluded from the candidate;
- no APK links, Android download instructions, pairing instructions, QR codes, six-digit codes, fingerprints, or mobile setup actions are displayed;
- no desktop candidate may claim Android validation, compatibility, or availability;
- historical documentation remains available and clearly marked preserved/paused.

## Required exclusion evidence for every promoted desktop candidate

Release and CI must record:

1. exact version, branch, pull request, and commit;
2. proof that `KHAOS_NEXUS_MOBILE_GATEWAY_ENABLED` is absent or disabled in the packaged candidate;
3. startup evidence showing no Mobile Gateway listener, pairing service, timer, or IPC registration;
4. module/runtime evidence showing Mobile Gateway unavailable and disabled despite any saved prior state;
5. UI/navigation evidence showing no active Mobile Companion route or pairing controls;
6. package-content review confirming no APK or Android release artifact is bundled or linked;
7. workflow evidence showing Android CI did not gate unrelated work;
8. release notes and Update Center metadata describing the exclusion;
9. unchanged preservation evidence for Android source, branches, workflows, and security records.

The release remains blocked if the gateway can start, pairing can be initiated, Android is advertised as active, or an APK is published.

## Future resumption requirements

Android and Mobile Gateway work may resume only after all of the following are recorded:

1. an explicit Owner directive to resume;
2. a new or amended architecture decision superseding the ADR-008 hold;
3. current project instructions and Register revision reviewed;
4. fresh inspection of preserved source, open branches, security evidence, CI state, dependency compatibility, and current desktop architecture;
5. one exact approved application branch, pull request, and commit baseline;
6. one exact preserved Android source checkpoint and an ancestry/integration decision;
7. new targeted handoffs for Android Companion, Desktop Application Core when gateway activation is required, and Release and CI when workflow, signing, or publication is required;
8. a current threat/security review covering certificates, pinning, pairing approval, device keys, signed requests, replay rejection, revocation, Keystore storage, redaction, and credential isolation;
9. restored path-scoped Android CI with unit tests and lint before any APK construction;
10. explicit authorization for signing and artifact publication before an APK exists;
11. a new Owner test session only after automated validation and exact artifact/signature/checksum evidence are complete.

Old issue #89, issue #100, PR #77, or prior APK evidence alone cannot authorize resumption.
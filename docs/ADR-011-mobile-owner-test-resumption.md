# ADR-011 — Android Mobile Owner-Test Resumption

**Date:** 2026-08-20  
**Status:** Active on `integration/mobile-owner-test-current` only  
**Owner direction:** Resume Khaos Nexus Mobile development in parallel with the desktop application and restore a usable, testable Owner build without rolling the desktop application back.

## Decision

ADR-008 remains historical evidence and remains the fallback production-hold contract. This ADR supersedes that hold only for the isolated mobile Owner-test integration track.

The current Nexus release line is the desktop baseline. The older `agent/v0.26.0-mobile-login` branch remains preserved as implementation and validation evidence and is not used as a Windows rollback target.

## Authentication

The Owner-test Android application uses certificate-first Nexus account enrollment:

1. The user enters a trusted private-network/VPN Nexus address.
2. Android contacts `/v1/health`, captures the presented TLS certificate, and requires the user to verify its SHA-256 fingerprint against the desktop.
3. Username and password are sent only after that verification over the pinned TLS session.
4. The desktop stores only a salted scrypt verifier in encrypted Nexus secrets storage.
5. Successful login issues a revocable Owner device credential bound to the Android P-256 public signing key.
6. The password is discarded on Android after enrollment.
7. Returning sessions require Android biometrics or the device credential before the saved session is unlocked.
8. Authenticated API calls retain timestamp, nonce, request-signature, replay rejection, certificate pinning, and device-revocation boundaries.

Legacy pairing code remains preserved as a recovery-compatible backend but is no longer the primary Android login UX.

## Network boundary

The Mobile Gateway is intended for a trusted LAN, private overlay network, or VPN. This ADR does not authorize direct public Internet exposure of the gateway.

## Live Functions catalog

`/v1/modules` is the mobile capability source. The Owner-test gateway enriches the runtime module state with bounded module descriptions, required role, workspace, status label, and current feature names from the shared Nexus module catalog.

Android presents this as **Functions**. The screen is data-driven so normal capability/status changes can appear without hardcoding a new Android screen for every Nexus function.

## Isolation and kill switch

The mobile Owner-test track is enabled by default only on its dedicated integration branch. `KHAOS_NEXUS_MOBILE_OWNER_TEST_DISABLED=1` (also `true`, `yes`, or `on`) disables the resumed track and returns startup to the preserved ADR-008 hold behavior.

No merge, updater publication, Play Store publication, public APK release, or production gateway activation is authorized by this ADR alone.

## Release validation contract

Every Owner-test APK candidate must pass all of the following on the exact candidate source:

1. production dependency audit;
2. mobile security/capability Node regression tests;
3. the complete repository regression suite;
4. repository checks;
5. Android unit tests;
6. Android lint;
7. debug package smoke build;
8. release APK assembly;
9. persistent Nexus mobile release-keystore requirement;
10. APK signature verification against the approved signing-certificate SHA-256 fingerprint;
11. application ID, version, minimum SDK, and target SDK verification;
12. APK SHA-256 checksum generation;
13. build evidence recording the exact branch, commit, workflow run, and signing-certificate fingerprint;
14. artifact upload only after all desktop-contract and Android validation jobs pass.

The release workflow must fail closed when the persistent signing identity is unavailable or changes unexpectedly. This preserves Android package continuity so later Owner-test builds can be installed as upgrades and provides the signing foundation required for a future in-app update flow.

The CI artifact is an **Owner-test artifact**, not a public release. Publication remains a separate explicit authorization.

### Required protected signing secrets

- `KHAOS_ANDROID_KEYSTORE_B64`
- `KHAOS_ANDROID_STORE_PASSWORD`
- `KHAOS_ANDROID_KEY_ALIAS`
- `KHAOS_ANDROID_KEY_PASSWORD`
- `KHAOS_ANDROID_CERT_SHA256`

These values must remain in repository/environment secrets. The keystore must never be committed to the repository or included in an artifact.

## Current Owner-test identity

- Android application ID: `com.khaosnexus.mobile`
- Version: `0.38.0-owner-test`
- Minimum SDK: 23
- Target SDK: 36
- Gateway default port: 43120

## Next architecture step

Nexus Account authentication may later replace initial username/password enrollment with Discord OAuth/passkey-based account identity. That future change must preserve the same device-key, revocation, certificate, replay, and authorization boundaries so it does not require a rewrite of the mobile command surfaces.

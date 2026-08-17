# ADR-009 — Resume Android Mobile Companion with Account Login

**Status:** Accepted  
**Date:** 2026-08-17  
**Supersedes:** ADR-008 Android Production Hold for the Owner-test track

## Context

ADR-008 paused Android Mobile Companion production while the desktop/runtime architecture stabilized. The Owner has now explicitly requested that Android development resume and that the mobile app use a normal login system instead of requiring a QR/code pairing link for routine use.

## Decision

1. Resume the Mobile Gateway and Android Owner-test build track.
2. Make username/password account login the primary Android enrollment flow.
3. Preserve the existing HTTPS self-signed certificate, explicit first-use fingerprint verification, certificate pinning, Android Keystore storage, P-256 per-device request signing, nonces, timestamps, rate limits, and revocable device credentials.
4. Never persist the Nexus account password on Android. A successful login issues the same class of revocable device credential used by the existing pairing system.
5. Store only a salted scrypt password verifier in the desktop encrypted secrets store; do not store plaintext passwords.
6. Require biometric or Android device-credential re-authentication before reopening a saved mobile session.
7. Keep the one-time QR/code pairing backend as a recovery/legacy path, but remove it from the primary Android UI.
8. Continue to recommend private-network/VPN access for remote monitoring. Do not expose the Mobile Gateway port directly to the public internet.
9. Keep remote mobile capabilities read-only by default. Future destructive/operator actions remain permission-gated, audited, and confirmation-protected.

## Consequences

- Android can be used from work or away from home once the phone has a secure private-network route to the Nexus desktop.
- The desktop Mobile Companion page gains Owner-only setup for the mobile username/password.
- Existing paired devices remain valid unless revoked or the certificate is rotated.
- The Android CI workflow resumes for Owner-test APK artifacts.

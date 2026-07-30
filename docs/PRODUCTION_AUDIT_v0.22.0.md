# Khaos Nexus v0.22.0 Production Audit

**Audit date:** 2026-07-30  
**Base checkpoint:** `test/v0.21.0-rust-webrcon`  
**Candidate:** `agent/v0.22.0-android-phase1`

## Audit scope

The audit covers the complete Phase 1 Android companion, its desktop HTTPS transport, the Owner control plane, and every v0.21.0 production foundation affected by the new service.

Reviewed surfaces:

- Android application manifest, backup, screenshots, cleartext policy, deep links, and QR scanning;
- Android Keystore signing and credential encryption;
- certificate generation, retention, pinning, rotation, and expiry;
- one-time pairing sessions, completion claims, Owner approval, and delivery;
- device credentials, public keys, roles, revocation, and public-state serialization;
- authenticated request canonicalization, signatures, timestamps, nonces, and body hashes;
- replay protection, request bounds, connection bounds, and rate limits;
- read-only API route inventory and output redaction;
- Mobile Gateway module state, Disable All, bulk changes, and transport lifecycle;
- renderer pairing and device-administration visibility;
- disk-write behavior during frequent Android refreshes;
- Android Gradle, SDK, Kotlin, Compose, scanner, lint, signing, and checksum workflows;
- npm production dependencies and Windows packaging;
- v0.21.0 Rust WebRCON, Game Adapter SDK, module control, startup, updater, monitor, status-panel, scheduler, moderation, and recovery contracts.

## Confirmed findings and repairs

### 1. The previous Mobile Gateway was a deliberately disabled foundation

The v0.21.0 foundation normalized the gateway to disabled and contained no network listener. Treating it as implemented would have exposed controls without an actual security boundary.

**Repair:** added a real optional HTTPS service, live Owner workspace, protected configuration lifecycle, native Android client, and a promoted implemented module state. The gateway setting remains disabled by default.

### 2. Cleartext or direct public-internet access was unacceptable

A mobile administration path must not silently downgrade to HTTP or advertise direct public router forwarding.

**Repair:** desktop transport is HTTPS-only with TLS 1.2 or newer. Android cleartext is disabled in the manifest and network security configuration. Configuration supports trusted LAN or private-network/VPN use; there is no public-port mode.

### 3. A self-signed desktop identity required explicit pinning

Normal platform trust cannot authenticate a per-installation self-signed certificate.

**Repair:** the desktop displays the certificate SHA-256 fingerprint and places it in the pairing QR. Android requires explicit fingerprint confirmation and accepts only the exact pinned certificate while still checking certificate validity.

### 4. Pairing needed a second desktop approval boundary

Possession of a short pairing code alone should not create a trusted mobile device.

**Repair:** Android submits a device name and P-256 public key, then waits. The desktop Owner sees the requested role and key fingerprint and must explicitly approve or reject the request.

### 5. Pairing state initially had an overly broad desktop read policy

The full pairing payload contains the active six-digit code and QR data. A desktop Viewer should not receive it.

**Repair:** `mobile-gateway:get` is wrapped with an Owner access assertion in addition to the Owner-only module and normal IPC module gate.

### 6. Approved credential delivery could be replayed during its delivery window

The initial completion route retained the approved plaintext credential in memory for two minutes and could return it more than once to the same claim secret.

**Repair:** a successful completion response marks the request delivered, clears the credential immediately, clears the pairing session, and requires a new pairing attempt if delivery is lost.

### 7. Desktop device credentials needed non-reversible storage

A mobile credential stored as plaintext on the desktop would become another exportable secret.

**Repair:** each credential is random, salted, and stored only as a scrypt hash. Timing-safe comparison is used during authentication. Public state omits hashes, salts, device public-key PEM, and last network addresses.

### 8. Android credential storage needed hardware-backed boundaries where available

Preferences or ordinary files would expose the bearer credential to application-data extraction.

**Repair:** Android encrypts the credential with a non-exportable Android Keystore AES-GCM key. The request-signing P-256 private key is also non-exportable and remains separate from the encrypted bearer credential.

### 9. Bearer credentials alone did not prevent captured-request replay

A captured HTTPS request should not remain valid when copied from application memory, logs, or a compromised local proxy.

**Repair:** every authenticated request includes a device ID, timestamp, random nonce, and P-256 signature over the exact method, path and query, timestamp, nonce, and SHA-256 body digest. The desktop enforces a two-minute time window and five-minute one-use nonce cache.

### 10. The API required a strict Phase 1 allowlist

Reusing desktop IPC or adapter actions would accidentally expose destructive operations.

**Repair:** the mobile service implements an explicit read-only route table. It does not expose bot start/stop, RCON, moderation, saves, module writes, updater installation, backup creation, or configuration mutation.

### 11. Public-safe data needed a final response redaction pass

Some upstream attention messages and logs can contain transport errors supplied by third-party libraries.

**Repair:** every JSON response and recent log entry passes through the existing Khaos Nexus redaction layer with the desktop secret inventory before leaving the HTTPS process.

### 12. Pairing and authentication required bounded resource use

Unbounded bodies, headers, sockets, or failed authentication could turn an optional local service into a denial-of-service path.

**Repair:** added header and request timeouts, a 64 KiB body limit, connection limits, per-address pre-authentication limits, lower pairing limits, per-device request limits, bounded public fields, and stale rate/nonce cleanup.

### 13. Device revocation needed to terminate existing live connections

Rejecting future credentials is insufficient while an authenticated event stream remains open.

**Repair:** revocation closes every registered stream for the device immediately and removes its replay cache. Future bearer and signature checks fail against the revoked record.

### 14. Module disable originally depended on periodic reconciliation

A five-second service timer was too slow for an authoritative Owner module switch.

**Repair:** direct module changes and bulk module modes schedule immediate gateway reconciliation. The periodic timer remains only as a recovery guard.

### 15. The implemented module still appeared as a partial foundation

The original static registry described the Mobile Gateway as future work. Consumers capture module functions early in startup.

**Repair:** a guarded registry promotion installs before module foundation consumers. It exposes the validated gateway as `live` and `implemented`, assigns the Mobile Companion view, provides completed migration steps, and retains saved Owner enable/disable choices.

### 16. Frequent mobile refreshes caused excessive configuration writes

The Android command deck requests several read-only resources per refresh. Updating `lastSeenAt` for every request would repeatedly rewrite configuration files.

**Repair:** device heartbeat persistence is limited to once per minute unless the observed address changes. Authentication and in-memory rate accounting remain per request.

### 17. The initial Android SDK package was unavailable on hosted runners

The first workflow requested an unreleased platform package and stopped before Kotlin compilation.

**Repair:** compile and target SDK use the stable Android 36 platform and Build Tools 36.0.0. The workflow still validates against current pinned Gradle, AGP, Kotlin Compose, Compose BOM, lifecycle, DataStore, and Google Code Scanner dependencies.

### 18. Google Code Scanner imports initially targeted the dependency artifact name

The dependency coordinates and Kotlin package names are different.

**Repair:** imports use the `com.google.mlkit.vision.codescanner` package and the standard barcode model package. Compilation, lint, release assembly, and signature verification pass.

### 19. Stable signing initially resolved the keystore from the wrong Gradle project directory

The app module resolves `file(...)` relative to `android/app`, while the workflow creates the keystore under `android/signing`.

**Repair:** stable signing uses `../signing/khaos-nexus-release.jks`. The workflow refuses to proceed without all permanent signing secrets.

### 20. Owner-test signing needed a visible separation from stable signing

A privately installable test APK is useful, but debug signing must never be presented as the permanent distribution identity.

**Repair:** the Owner-test release APK intentionally falls back to Android debug signing and is labeled `owner-test`. Stable tag builds require the external keystore and cannot silently fall back.

### 21. Android capture and backup paths required explicit blocking

Sensitive status and device identifiers can appear on screen even though desktop credentials are absent.

**Repair:** `FLAG_SECURE` blocks screenshots and screen recording, Android backup is disabled, and the application does not request broad storage permissions.

### 22. Source-only HTTPS checks were insufficient

Syntax assertions cannot prove certificate generation or socket lifecycle behavior.

**Repair:** the Node regression suite now creates a real certificate, starts the HTTPS gateway on an unused port, calls the health endpoint, creates a QR pairing session, verifies redaction, stops the listener, confirms connection failure after stop, and cleans timers and temporary files.

### 23. Release promotion initially invalidated older version contracts

The repository intentionally locks startup, scrolling, updater, SDK, Rust, and Owner module behavior to the current guarded release identity.

**Repair:** v0.22.0 contracts were advanced while retaining all v0.21.0 Rust WebRCON and v0.20.0 adapter assertions.

### 24. The dependency graph needed a committed lockfile

The project previously relied on `npm install` without a committed `package-lock.json` for the new QR and certificate dependencies.

**Repair:** the v0.22.0 dependency graph is generated and committed before final packaging, then the temporary refresh automation is removed.

## Read-only endpoint inventory

- `GET /v1/health` — unauthenticated gateway identity and certificate fingerprint;
- `POST /v1/pairing/request` — active-code enrollment request;
- `POST /v1/pairing/complete` — claim polling and one-time approved delivery;
- `GET /v1/session`;
- `GET /v1/dashboard`;
- `GET /v1/discord`;
- `GET /v1/servers`;
- `GET /v1/servers/<id>`;
- `GET /v1/modules`;
- `GET /v1/logs`;
- `GET /v1/status-panels`;
- `GET /v1/update`;
- `GET /v1/events`.

## Automated coverage

Desktop and shared tests verify:

- HTTPS-only normalization and safe defaults;
- P-256 public-key validation and fingerprinting;
- pairing-code expiry and single use;
- hashed claim and device credentials;
- public-state secret removal;
- signed canonical requests and altered-path rejection;
- timestamp rejection;
- immediate revocation and role order;
- startup install order and module promotion;
- Owner-only pairing-state access;
- one-time credential delivery source boundary;
- read-only route inventory;
- Android manifest and Keystore source boundaries;
- real certificate generation and HTTPS lifecycle;
- QR generation and redaction;
- v0.21.0 Rust, startup, updater, scrolling, SDK, and Owner-control foundations.

Android gates verify:

- canonical request unit tests;
- debug unit-test compilation;
- Android lint;
- release APK assembly;
- APK signature verification;
- APK SHA-256 generation;
- artifact upload.

## Final release gates

The exact final checkpoint must pass:

1. high-severity npm production dependency audit;
2. complete Linux Node behavioral suite;
3. repository-wide JavaScript syntax audit;
4. real HTTPS lifecycle regression;
5. Windows dependency installation;
6. complete Windows Node behavioral suite;
7. Windows syntax audit;
8. NSIS installer build;
9. portable executable build;
10. Windows executable existence, size, and SHA-256 verification;
11. Android SDK and Java setup;
12. Android unit tests;
13. Android lint;
14. owner-test release APK build;
15. APK signature verification;
16. APK SHA-256 generation;
17. Windows and Android artifact upload.

## Manual Owner-device validation still required

Automated runners cannot reproduce the Owner's Windows profile, Android hardware Keystore, Wi-Fi/VPN routing, firewall, sleep behavior, certificate comparison, Discord environment, game servers, or upgrade history.

Before stable publication, validate:

- v0.22.0 reaches the desktop interface without freezing;
- v0.21.0 module choices and server credentials remain intact;
- the Mobile Gateway module appears implemented and can be disabled independently;
- the gateway remains closed until its setting is enabled;
- LAN and private-network endpoints match the intended adapters;
- the desktop and phone display the same certificate fingerprint;
- QR scanning and deep-link pairing work on a physical phone;
- desktop approval shows the expected device name and key fingerprint;
- approved pairing creates one device and does not allow repeat credential delivery;
- the Android command deck refreshes Discord, servers, modules, logs, panels, and update state;
- no desktop credential appears in the Android UI, logs, traffic errors, or exported application data;
- revocation returns the phone to pairing and closes any live stream;
- disabling the module closes the HTTPS listener immediately;
- certificate rotation revokes all phones and requires re-pairing;
- Windows Firewall prompts and private-network profiles are understandable;
- the Owner-test APK installs and its displayed signer matches the recorded artifact signer;
- updater and verified pre-update backup behavior remain intact.

## Deliberate boundaries

- v0.22.0 Android operations are read-only.
- The phone never connects directly to Discord, GitHub, RCON, WebRCON, game REST APIs, Pterodactyl, or hosting providers.
- No public cloud relay or push-notification service is included.
- Direct public router port forwarding is not supported.
- TLS certificate validation is not globally disabled; Android accepts only the pinned certificate.
- Debug-signed Owner-test APKs are not stable releases.
- Stable publication waits for the permanent Android signing key and physical-device validation.
- No stable desktop or Android release is automatically published from this audit branch.

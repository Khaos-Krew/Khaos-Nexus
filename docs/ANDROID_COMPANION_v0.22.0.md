# Khaos Nexus Android Companion — v0.22.0

## Scope

v0.22.0 delivers the first native Android companion and the desktop HTTPS security boundary it requires. This release is intentionally read-only. The phone can observe public-safe Khaos Nexus state, but it cannot start or stop the Discord bot, execute RCON, moderate players, change modules, install updates, or access desktop credentials.

## Security boundary

Protected credentials remain on the Windows desktop:

- Discord bot and OAuth credentials;
- GitHub credentials;
- RCON, WebRCON, REST, and hosting-provider passwords;
- Pterodactyl API keys;
- updater and monitor secrets.

The Android application stores only:

- the selected HTTPS desktop endpoint;
- the pinned desktop certificate SHA-256 fingerprint;
- a device identifier and assigned role;
- one device credential encrypted with an Android Keystore AES-GCM key;
- one non-exportable P-256 request-signing private key in Android Keystore.

Screenshots and screen recording are blocked with `FLAG_SECURE`, Android backup is disabled, and cleartext HTTP is disabled in both the manifest and network security configuration.

## Desktop HTTPS gateway

The gateway is optional and disabled by default. It runs only when:

1. the Owner-controlled **Mobile Companion Gateway** module is enabled; and
2. the gateway setting is enabled.

A per-installation self-signed certificate is generated on first start and retained in the desktop data directory. The Owner compares its SHA-256 fingerprint during pairing. The Android client accepts only that exact certificate and rejects changed, expired, or mismatched certificates.

The service enforces:

- TLS 1.2 or newer;
- bounded request headers and 64 KiB bodies;
- per-address pre-authentication rate limits;
- per-device request limits;
- P-256 signatures over the exact method, path/query, timestamp, nonce, and body hash;
- a two-minute timestamp window;
- five-minute nonce replay detection;
- scrypt-hashed device credentials;
- immediate credential revocation and event-stream closure;
- one-time approved credential delivery;
- redaction before any API response leaves the desktop.

## Pairing flow

1. The Owner enables the gateway and trusted local/private-network access.
2. The desktop creates a five-minute QR code and six-digit pairing code.
3. The QR includes the HTTPS endpoint, pairing code, session ID, and certificate fingerprint.
4. The Android client shows the fingerprint and requires explicit user confirmation.
5. Android creates a non-exportable P-256 signing key and submits only the public key.
6. The desktop displays the device name, requested role, and public-key fingerprint.
7. The Owner explicitly approves or rejects the request.
8. After approval, Android retrieves the device credential once over the pinned TLS connection.
9. The credential is encrypted immediately with Android Keystore-backed AES-GCM storage.

A lost completion response requires a new pairing session. This avoids replayable credential delivery.

## Phase 1 API

The authenticated API is read-only:

- `GET /v1/session`
- `GET /v1/dashboard`
- `GET /v1/discord`
- `GET /v1/servers`
- `GET /v1/servers/<id>`
- `GET /v1/modules`
- `GET /v1/logs`
- `GET /v1/status-panels`
- `GET /v1/update`
- `GET /v1/events`

Public pairing routes are limited to health, enrollment request, and enrollment completion.

## Android command deck

The Compose application provides:

- Command Deck summary;
- Discord runtime status;
- configured game-server health;
- effective Owner module state;
- redacted recent logs;
- Discord status-panel health;
- desktop update state;
- device-session details and local forget action.

The application refreshes through signed HTTPS requests. A revoked or invalid credential clears the local session and returns the phone to pairing.

## Builds and signing

The Owner-test workflow runs Android unit tests, lint, release assembly, APK signature verification, SHA-256 generation, and artifact upload. The Owner-test APK uses the standard Android debug signing identity so it can be installed for private validation.

Stable Android publication is separate. The stable workflow refuses to build without the permanent external signing keystore and passwords supplied through repository secrets. A debug-signed APK is never treated as a stable public release.

## Network guidance

- Use the same trusted local network or a private VPN/overlay network.
- Do not forward the Mobile Gateway port directly from a home router to the public internet.
- Confirm the certificate fingerprint on the desktop and phone before approval.
- Rotate the certificate if the desktop identity is uncertain; rotation revokes every paired device.

## Deliberate v0.22.0 limits

- Android actions remain read-only.
- No direct RCON, WebRCON, REST, Discord, GitHub, or hosting-provider connection is made by the phone.
- No cloud relay is included.
- No background push service is included.
- Rust+, uMod, Oxide, Carbon, and game-plugin telemetry are not assumed.
- Stable Android distribution waits for the permanent signing key and Owner-device validation.

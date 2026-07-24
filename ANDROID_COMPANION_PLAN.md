# Khaos Nexus Mobile — installable Android APK plan

Khaos Nexus Mobile is a native Android companion for the Windows desktop application. It is not a second bot manager and never stores Discord bot tokens, GitHub tokens, RCON passwords, Palworld AdminPasswords, or server-provider credentials.

The phone pairs with the trusted Windows application and sends typed, permission-checked requests to it. The Windows application remains the security boundary and performs all Discord, server, backup, update, and automation work.

## Product identity

- Product name: **Khaos Nexus Mobile**
- Package name: `com.khaosnexus.mobile`
- Branding: the same Khaos Nexus wolf-and-dragon crest
- Theme: black, ruby red, brushed metal, restrained holographic cyan, scan-line and status-light accents
- Distribution target: signed installable APK from a Khaos Nexus GitHub Release
- Optional future distribution: Google Play closed testing and production release

## Core rule

**The phone controls the desktop; it does not replace it.**

This keeps one source of truth for:

- Owner, Operator, Viewer, and Locked permissions
- protected secrets
- server configuration
- Discord configuration
- audit records
- backups
- module state
- update state
- automation schedules

## Phase 1 — paired read-only companion

The first installable APK should provide:

- QR-code or six-digit pairing with the desktop application
- desktop online/offline state
- Discord bot status, latency, uptime, memory, and connected guild count
- configured game-server status
- Palworld players, version, uptime, FPS, frame time, and world day
- module migration progress
- recent redacted logs
- status-panel health
- update availability
- device revocation from the desktop

This phase deliberately excludes destructive actions.

## Phase 2 — safe Operator actions

After read-only pairing is stable:

- start, stop, and restart the Discord bot
- refresh server status
- save a game world
- publish a configured announcement
- refresh Discord status panels
- run Safe Recovery
- create a verified configuration backup

Every action is typed, audited, rate-limited, and checked against the paired device role on the desktop.

## Phase 3 — guarded Owner actions

Owner-only functions require a second confirmation and optional Android biometric authentication:

- Maintenance Mode
- player kick and ban
- scheduled server shutdown
- emergency force stop
- configuration restore
- device-role changes
- mobile gateway changes

The desktop may require a final approval for especially destructive actions.

## Phase 4 — remote access and notifications

Local network access is the default. Remote access is added only after local pairing is secure.

Preferred options:

1. User-managed private network such as Tailscale or WireGuard
2. Optional Khaos Nexus relay with end-to-end encrypted device sessions
3. No direct public port forwarding of the desktop gateway

Notifications can later include:

- bot crash or recovery
- game server offline
- repeated RCON or REST failure
- backup failure
- Maintenance Mode completion
- player threshold alerts
- update ready

## Android architecture

Use a native Kotlin application with Jetpack Compose.

Suggested modules:

- `app` — Android entry point, navigation, theme, dependency wiring
- `core-model` — shared API models and permissions
- `core-network` — pairing, authenticated HTTP, event stream, certificate pinning
- `core-storage` — encrypted device session, preferences, cache
- `feature-pairing`
- `feature-dashboard`
- `feature-discord`
- `feature-servers`
- `feature-modules`
- `feature-logs`
- `feature-settings`

Use a single-activity application with unidirectional data flow:

- Compose screen
- ViewModel
- repository
- local or desktop-gateway data source

## Desktop gateway architecture

The Windows application adds an optional **Mobile Gateway** that is disabled by default.

### Pairing

1. Owner opens **Mobile Companion** in the desktop app.
2. Desktop creates a short-lived pairing session.
3. Desktop displays a QR code and six-digit fallback code.
4. Phone scans or enters the code.
5. Phone verifies the desktop certificate fingerprint.
6. Desktop displays the requested device name and role.
7. Owner approves the device.
8. Desktop returns a single-use device credential.
9. Phone stores the credential using Android Keystore-backed encryption.
10. Desktop stores only a salted hash and device metadata.

Pairing sessions expire after five minutes and can be used once.

### Device record

Each approved phone record contains:

- device ID
- display name
- Owner, Operator, or Viewer role
- public-key fingerprint
- salted credential hash
- created time
- last-seen time
- last IP address for audit only
- enabled or revoked state

No reusable plaintext token is stored by the desktop.

### Transport

- HTTPS only
- desktop-generated certificate and per-installation fingerprint
- phone pins the approved desktop certificate
- bearer device credential plus request nonce
- replay protection
- request timestamps
- rate limits per device
- WebSocket or server-sent events for live status
- no cleartext LAN fallback in release builds

## Initial API surface

Read-only:

- `GET /v1/health`
- `GET /v1/session`
- `GET /v1/dashboard`
- `GET /v1/discord`
- `GET /v1/servers`
- `GET /v1/servers/{id}`
- `GET /v1/modules`
- `GET /v1/logs?after=`
- `GET /v1/status-panels`
- `GET /v1/update`
- `GET /v1/events`

Operator actions:

- `POST /v1/actions/bot/start`
- `POST /v1/actions/bot/stop`
- `POST /v1/actions/bot/restart`
- `POST /v1/actions/servers/{id}/check`
- `POST /v1/actions/servers/{id}/save`
- `POST /v1/actions/status-panels/{id}/refresh`
- `POST /v1/actions/recovery`
- `POST /v1/actions/backups`

Owner actions are added only after the read-only and Operator contracts are tested.

## Android screens

### Pairing

- animated Nexus crest
- scan QR
- enter code manually
- certificate fingerprint confirmation
- device name
- pairing status

### Command Deck

- desktop connection
- Discord runtime
- game-network summary
- alerts
- quick safe actions
- latest activity

### Discord

- runtime state
- restart controls
- connected guild
- status panels
- Embed Studio preview status

### Game Servers

- server cards
- status, players, uptime, version, performance
- save and refresh actions
- Palworld details
- future ARK cluster details

### Modules

- migration progress
- operational, building, foundation, and queued filters
- dependency state
- read-only roadmap on the phone

### Logs

- redacted live activity
- severity filters
- error fingerprint
- no protected values

### Settings

- paired desktop
- certificate fingerprint
- device role
- biometric confirmation toggle
- notification preferences
- revoke this device
- APK update status

## APK release process

1. Android project passes unit tests and lint.
2. Release APK is built with Gradle.
3. APK is signed with the permanent Khaos Nexus Android signing key.
4. Signature is verified.
5. SHA-256 checksum is generated.
6. APK and checksum are uploaded to a GitHub Release.
7. The phone app can check the stable release channel and open the Android package installer for an approved update.

The signing key must never be committed to GitHub. CI receives the encrypted keystore and passwords through repository secrets.

## Compatibility target

- phones and tablets
- portrait-first layout with adaptive tablet panels
- broad Android support while targeting the current stable Android SDK at build time
- local-network permission handling prepared for newer Android privacy restrictions

## Non-goals for the first APK

- storing server passwords on the phone
- running the Discord bot on Android
- direct RCON or Palworld REST connections from Android
- direct public exposure of the Windows desktop
- full mobile editing of every desktop configuration
- bypassing desktop access-control rules

## Acceptance gate for the first installable APK

The first APK is ready when:

- it installs normally outside Android Studio
- the APK signature verifies
- it pairs with a desktop using QR and fallback code
- revoking the device immediately blocks it
- Viewer cannot trigger Operator actions
- no protected secret appears in phone storage, logs, screenshots, API responses, or crash reports
- dashboard and server status recover cleanly after Wi-Fi loss
- a verified checksum is published with the APK

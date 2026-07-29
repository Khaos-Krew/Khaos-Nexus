# Khaos Nexus v0.21.0 Production Audit

**Audit date:** 2026-07-29  
**Base checkpoint:** `test/v0.20.0-game-adapter-sdk`  
**Candidate:** `agent/v0.21.0-rust-webrcon`

## Audit scope

The production audit was performed after implementing the Rust WebRCON adapter and before producing an Owner-test Windows build.

Reviewed surfaces:

- official Rust dedicated-server WebRCON configuration and vanilla command surface;
- host, port, password, `ws`/`wss`, IPv4, IPv6, and endpoint validation;
- WebSocket request/response framing and identifier correlation;
- timeout, cancellation, malformed packet, response-size, close, and authentication behavior;
- protected credential storage and error redaction;
- typed command construction and command-injection boundaries;
- Rust player parsing and privacy;
- Game Adapter SDK capability declarations and access policy;
- desktop Rust configuration and operations UI;
- Owner module persistence, dependencies, Disable All, Safe Mode, and repair access;
- Discord command registration, autocomplete, access control, and execution path;
- player moderation, status panels, autonomous health checks, maintenance, and scheduling;
- extension startup order and compatibility with v0.20.0 audit repairs;
- release identity, startup, navigation, scrolling, updater, dependency, and Windows packaging contracts.

## Confirmed findings and repairs

### 1. Rust required a dedicated transport

The previous generic server model would treat an unknown Rust entry as Source/Minecraft-style RCON. Current Rust dedicated servers use WebRCON when `rcon.web 1` is enabled.

**Repair:** added a dedicated Rust WebRCON client, server type, configuration fields, adapter manifest, operations workspace, and module.

### 2. WebRCON responses needed request correlation

Rust can deliver console packets unrelated to the command that initiated a request.

**Repair:** every request receives a generated identifier. The client ignores unrelated packets and accepts only the matching response.

### 3. Password-bearing connection URLs could leak encoded credentials

A WebSocket library can include the complete failed URL in an exception. Redacting only the raw password does not remove its percent-encoded representation.

**Repair:** Rust errors redact the raw password, encoded password, and credential-bearing WebSocket URL path before the error reaches logs, diagnostics, Discord, or the renderer.

### 4. Combined endpoint fields produced ambiguous URLs

Accepting `host:port`, `[IPv6]:port`, protocols, paths, or query strings in the host field could create incorrect or misleading WebSocket destinations.

**Repair:** host and port are validated separately. IPv4, DNS, bracketed IPv6, and unbracketed IPv6 are normalized; combined host/port and URL input are rejected with actionable guidance.

### 5. Typed Rust arguments needed command-injection protection

Announcements, kick reasons, player labels, and ban reasons eventually become console command text.

**Repair:** typed values are bounded and reject carriage returns, line feeds, and semicolon chaining. Raw console remains a separate Owner-only capability with a single-line and length restriction.

### 6. Player output contained more data than the application should expose

Rust `playerlist` responses can include network address data and non-Steam identifiers.

**Repair:** the normalized player model retains public-safe display name, Steam64 ID, ping, and connected time. IP addresses are discarded, and moderation accepts only valid Steam64 identifiers.

### 7. Expected shutdown disconnects were reported as failures

The `quit` command can close WebRCON before sending a normal reply. A synchronous close could also occur while the request was still recording its sent state.

**Repair:** graceful shutdown runs `save` first, marks the command sent before the socket write, and treats a non-authentication close caused by the confirmed `quit` request as completion.

### 8. Adapter cancellation leaked into public operation payloads

The first bridge revision inserted the SDK AbortSignal into the payload object, changing existing adapter contracts and exposing transport metadata to operation handlers.

**Repair:** cancellation is passed through a separate transport-options argument. Existing Palworld, ARK, and generic payload shapes remain unchanged.

### 9. Rust module state initially covered only the new desktop buttons

A disabled game module must stop all operational paths, not merely hide one workspace control.

**Repair:** Rust module state now gates desktop IPC, Discord autocomplete and actions, status panels, player moderation, autonomous health, maintenance, schedules, and scheduled WebRCON shutdown. The Game Servers editor remains accessible for repair.

### 10. Audit-wrapper order could overwrite Rust health filtering

The common v0.20 audit repair installs an updated `checkServers` implementation. Installing Rust before that wrapper would replace the Rust-aware method.

**Repair:** common audit repairs install first. Rust then extends the audited service class, and a final Rust gate wraps the resulting methods before service instances are created.

### 11. Rust service overrides could bypass the Operator Console module wrapper

Subclass methods replace inherited prototype wrappers.

**Repair:** the final Rust gate reapplies `operator-console` enforcement to health checks and Maintenance Mode after all Rust service overrides are installed.

### 12. Discord game commands bypassed the Game Adapter SDK

The first Discord integration called `ServerConnection` directly, which skipped the SDK capability and redaction envelope used by the desktop.

**Repair:** Discord game actions now create the same current-server adapter and execute through `executeAdapterOperation` with protected credentials supplied as explicit redaction values.

### 13. Discord raw console was broader than the desktop Owner policy

Discord Administrator permission alone could reach the raw command surface, while the SDK classifies raw console as Owner-only.

**Repair:** `/rcon` requires the configured Khaos Nexus Owner user ID. Other existing administrative commands continue to support the configured Owner or a Discord Administrator.

### 14. Shared commands advertised unsupported server combinations

Global slash commands such as `unban`, `settings`, and `rcon` can exist while only some transports support them.

**Repair:** Discord server autocomplete filters each command using the selected server adapter’s declared capabilities. Rust does not receive Palworld-only commands, Palworld REST does not receive raw RCON, and ARK does not advertise unsupported unban.

### 15. Rust server information was discarded by generic status panels

The first panel mapping retained players and FPS but dropped queue, joining, map, and entity data returned by `serverinfo`.

**Repair:** the shared public-safe status snapshot and embed renderer now support queue, joining, map, and entity count in addition to players, version, FPS, uptime, and optional names.

### 16. Scheduled shutdown required a hosting-panel power provider

The scheduler could warn and save a Rust server but its final stop used only hosted-provider power control.

**Repair:** when no hosted provider is linked, a scheduled Rust **shutdown** falls back to the guarded WebRCON save-and-quit operation. Scheduled **restart** still requires a supported host provider because WebRCON cannot start a stopped process.

### 17. Temporary autonomy filtering had a recursion hazard

A first implementation temporarily replaced `getRuntimeBootstrap` and then checked module state through the same wrapped method.

**Repair:** module state is resolved from an already-loaded runtime snapshot, and the final health and maintenance implementations filter that snapshot directly.

## Implemented Rust capability inventory

- `status` and `info` through `serverinfo`;
- `players` through JSON `playerlist`;
- `announce` through typed `say`;
- `save` through `save`;
- `kick` through Steam64 `kick`;
- `ban` through Steam64 `banid`;
- `unban` through Steam64 `unban`;
- `shutdown` through save followed by `quit`;
- `stop` through confirmed `quit`;
- Owner-only `raw` console.

The adapter deliberately does not claim Rust+, uMod, Oxide, Carbon, plugin telemetry, file access, or host-process restart support.

## Automated regression coverage

The suite verifies:

- encoded password URL construction and redaction;
- IPv4, IPv6, and split host/port validation;
- packet identifier matching and unsolicited-packet rejection;
- JSON `serverinfo` and `playerlist` normalization;
- player IP privacy and Steam64 filtering;
- typed command-injection rejection;
- timeout, cancellation, authentication, malformed response, and expected-close behavior;
- save-before-shutdown ordering;
- exact adapter capability declarations;
- legacy-compatible Rust status, list, save, and broadcast aliases;
- Owner module dependency and IPC decisions;
- Discord SDK execution and Owner-only raw console;
- Discord capability-aware autocomplete;
- status-panel queue, joining, map, entity, FPS, uptime, and disable behavior;
- common audit, Rust extension, final module-gate, and main-instance startup order;
- Operator Console enforcement on Rust service overrides;
- scheduled shutdown fallback source contract;
- v0.20.0 SDK, startup, scrolling, navigation, updater, monitor, and Owner-control foundations;
- v0.21.0 release identity and notes.

## Release gates

The exact final checkpoint must pass:

1. high-severity production dependency audit;
2. complete Linux behavioral suite;
3. repository-wide JavaScript syntax audit;
4. Windows dependency installation;
5. complete Windows behavioral suite;
6. Windows syntax audit;
7. NSIS installer build;
8. portable executable build;
9. executable existence and minimum-size verification;
10. executable SHA-256 generation;
11. artifact upload.

## Manual Owner-device validation still required

Automated tests cannot reproduce the Owner’s exact Windows profile, hosted Rust firewall, real WebRCON implementation, Discord guild permissions, encrypted credential store, TLS proxy, hosting panel, or server version.

Before stable publication, validate:

- v0.21.0 reaches the main interface without freezing;
- v0.20.0 module choices persist after upgrade;
- Rust appears as a dedicated server type;
- an existing Rust password remains protected after editing without re-entering it;
- `ws` connects only across the intended trusted/firewalled path;
- `wss` accepts a valid certificate and rejects an untrusted certificate;
- connection test uses Rust server information rather than legacy Source RCON;
- desktop status, players, save, announcement, and shutdown work;
- Players & Moderation can kick, ban, and unban using Steam64 IDs;
- Rust status panels publish and refresh with valid button components;
- queue, joining, map, entities, FPS, and uptime display correctly when the server supplies them;
- disabling Rust blocks desktop, Discord, panels, players, health, maintenance, and schedules while leaving repair configuration accessible;
- Discord autocomplete offers Rust only for supported commands;
- Discord `/rcon` rejects non-Owner administrators;
- scheduled shutdown works without a hosted provider;
- scheduled restart clearly requires a supported host provider;
- monitor reports genuine Rust failures without exposing the WebRCON password;
- updater remains visible and requires a verified pre-update backup.

## Deliberate boundaries

- No stable release is automatically published from this audit branch.
- Standard `ws` WebRCON is not represented as encrypted.
- TLS certificate validation is never globally disabled.
- Raw console remains Owner-only and single-line.
- Community plugin commands are not assumed.
- Rust process restart requires a supported hosting provider or an external process manager.
- Future Rust+ event integration remains a separate reviewed phase.
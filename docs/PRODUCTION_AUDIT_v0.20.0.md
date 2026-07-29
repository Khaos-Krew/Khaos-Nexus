# Khaos Nexus v0.20.0 Production Audit

**Audit date:** 2026-07-29  
**Base checkpoint:** `test/v0.19.0-owner-module-control`  
**Candidate:** `agent/v0.20.0-game-adapter-sdk`

## Audit scope

This audit covers the Game Adapter SDK foundation and the first migration of existing Palworld REST and ARK/generic RCON consumers.

Reviewed surfaces:

- adapter identity and capability manifests;
- viewer, operator and Owner requirements;
- destructive-action declarations;
- custom game-specific capabilities;
- operation timeouts and cancellation;
- error normalization and retry classification;
- credential and response redaction;
- large world-data and telemetry payload preservation;
- circular and binary result behavior;
- adapter registration and factory identity;
- opt-in fixture recording and rotation;
- Palworld REST capability mapping;
- ARK and generic RCON capability mapping;
- Palworld desktop action confirmation flow;
- Discord status-panel status and player checks;
- v0.19.0 Owner module and startup compatibility;
- dependency vulnerabilities;
- Windows installer and portable packaging.

## Confirmed findings and repairs

### 1. Server integrations lacked a shared security contract

Existing transports exposed useful typed actions, but every future game adapter would otherwise need to recreate access policy, timeouts, result formatting and errors independently.

**Repair:** introduced `shared/game-adapter-sdk.cjs` with capability manifests, a common executor, a stable error model and a registry.

### 2. Custom capabilities could have inherited permissive defaults

The first SDK draft allowed an unknown capability such as `rust.queue` to fall back to viewer, non-destructive behavior when its policy was omitted.

**Repair:** supported non-core capabilities must explicitly declare both `requiredRole` and `destructive`. Incomplete custom capability definitions are rejected during manifest normalization.

### 3. Capability policy objects were only shallowly protected

The manifest container was frozen, but nested capability definitions—and initially the exported core-default definitions—could have been mutated after validation.

**Repair:** every normalized capability definition and every core policy definition is frozen. Runtime code cannot rewrite `ban`, `shutdown`, `raw` or other access defaults after startup.

### 4. Adapter output redaction did not cover every credential-shaped field

The general redactor protected common password and token names, but future protocol responses could contain authorization, cookie, session, credential, private-key or RCON fields.

**Repair:** adapter results, metadata and error details use an adapter-specific recursive redactor covering all of those field families plus explicitly supplied secrets.

### 5. Large operational results could have been truncated

The initial recursive redactor bounded arrays, object fields and strings. That behavior is appropriate for diagnostics but could damage Palworld world-data exports or future telemetry/save results.

**Repair:** live operation output preserves complete arrays and strings after redaction. Only the explicitly enabled fixture recorder truncates diagnostic samples.

### 6. Circular or binary adapter results were not defined

A malformed/custom adapter could return a circular structure and make redaction recurse indefinitely. Buffer output could also expand into thousands of numeric fields.

**Repair:** circular references become `[CIRCULAR]`; excessive nesting becomes `[MAX_DEPTH]`; Date values become ISO timestamps; Buffer values become public-safe byte-length metadata.

### 7. Already-cancelled work could enter the operation race

The first timeout helper mirrored an external AbortSignal into an internal controller, but an already-aborted signal required explicit handling before listeners were installed.

**Repair:** pre-cancelled operations reject immediately with `CANCELLED`. Live cancellation and timeout remain bounded and remove their listeners in `finally`.

### 8. Timeout and cancellation errors lacked adapter context

Errors created inside the timeout layer initially had no adapter ID, game ID or capability.

**Repair:** all errors are rebuilt through the outer operation context so diagnostics retain adapter and capability identity, request ID and retry classification.

### 9. Normalized errors retained raw transport causes

Attaching an original network error as `cause` could allow a logger or object inspector to expose an unredacted URL, header or credential-bearing message.

**Repair:** outward `GameAdapterError` objects do not retain the raw cause. The normalized message and details are redacted before leaving the executor.

### 10. Fixture clocks assumed Date objects

The fixture recorder accepted an injected clock but the first implementation expected `getTime()` directly, which was incompatible with common numeric test clocks.

**Repair:** Date, number and date-string inputs are normalized before recording.

### 11. Existing consumers bypassed the adapter contract

Palworld desktop actions and Discord status panels called `ServerConnection` directly.

**Repair:** both now create the current-server adapter and execute typed capabilities through `executeAdapterOperation`. Existing input validation, Owner confirmations and injected test transports remain intact.

### 12. Capability claims needed to reflect real transport behavior

Palworld REST should not expose raw RCON commands, while ARK’s current command map should not advertise an unsupported unban operation.

**Repair:** the current-server bridge builds transport-specific manifests. Interfaces can rely on the manifest rather than guessing from the game name.

## SDK guarantees

### Capability declaration

Each adapter declares:

- adapter ID;
- game ID;
- display name;
- transport;
- adapter version;
- supported capabilities;
- required access role;
- destructive status;
- timeout;
- optional dry-run behavior;
- redacted metadata.

### Default access policy

- **Viewer:** status, health, info, players, metrics and read-only settings.
- **Operator:** announcements, saves, backups and kicks.
- **Owner:** bans, unbans, shutdown, restart, force stop, raw commands, full world data and configuration writes.

Custom capabilities must supply their own reviewed policy.

### Stable errors

- `ADAPTER_UNAVAILABLE`
- `CAPABILITY_UNSUPPORTED`
- `ACCESS_DENIED`
- `AUTH_FAILED`
- `CONNECTION_FAILED`
- `TIMEOUT`
- `RATE_LIMITED`
- `INVALID_REQUEST`
- `INVALID_RESPONSE`
- `ACTION_REJECTED`
- `SECURITY_POLICY`
- `CANCELLED`
- `INTERNAL`

### Current bridge

Palworld REST advertises typed REST operations and does not advertise raw commands.

ARK RCON advertises status, players, announcements, saves, moderation, shutdown and Owner-only raw commands. It does not advertise unban because the current command map does not implement it.

Generic and Palworld legacy RCON capabilities are derived from the existing safe command map.

## Fixture recorder boundaries

The recorder is disabled unless both an enable flag and directory are supplied.

It provides:

- recursive credential redaction;
- bounded diagnostic records;
- redacted oversized previews;
- file rotation;
- adapter-specific list and clear operations.

It is not wired to a normal production UI and is not enabled automatically.

## Automated regression coverage

The v0.20.0 suite verifies:

- core and custom capability policy;
- deep immutability of security definitions;
- viewer/operator/Owner enforcement;
- destructive-action metadata;
- unsupported-capability refusal;
- timeouts and pre-cancellation;
- contextual stable errors;
- removal of raw error causes;
- authorization, cookie, session, token and explicit-secret redaction;
- complete large-array and long-string preservation;
- circular-result handling;
- adapter registry duplicate protection;
- factory identity validation;
- fixture truncation, redaction, numeric clocks, listing and clearing;
- Palworld REST and ARK RCON capability differences;
- typed operation delegation;
- Palworld and Discord status-panel SDK migration;
- v0.19.0 Owner module controls;
- startup, navigation, scrolling, watchdog, updater and backup foundations;
- production dependency audit;
- v0.20.0 release identity and notes.

## Release gates

The exact final source checkpoint must pass:

1. high-severity production dependency audit;
2. complete Node behavioral test suite;
3. repository-wide JavaScript syntax check;
4. Windows dependency installation;
5. Windows copy of the complete test suite;
6. Windows syntax check;
7. NSIS installer packaging;
8. portable executable packaging;
9. executable existence and minimum-size verification;
10. SHA-256 generation;
11. artifact upload.

## Manual Owner-device validation still required

Automated runners cannot reproduce the Owner’s Windows 10 credential store, Discord guild permissions, Palworld host, ARK cluster endpoints or local firewall behavior.

Before stable publication, validate:

- application reaches the main interface without freezing;
- v0.19.0 module choices remain preserved;
- Discord bot start, stop, commands and buttons remain operational;
- Palworld REST status, players, announcement, save and moderation behave as before;
- Palworld world-data export remains complete rather than truncated;
- ARK status panels still parse player output correctly;
- generic RCON connection guidance remains accurate;
- protected server passwords are retained and never displayed;
- update center remains visible and requires a verified pre-update backup.

## Deliberate boundaries

- Rust, Satisfactory, 7 Days to Die, Minecraft Bedrock, DayZ and other researched adapters are not claimed as implemented.
- No public adapter gateway or Mobile Companion network transport is enabled.
- Fixture recording is not a normal production feature.
- Current server behavior remains governed by the v0.19.0 Owner module switches.
- Stable publication remains blocked until Owner-device validation.

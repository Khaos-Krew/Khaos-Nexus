# Khaos Nexus Game Adapter SDK

**Phase:** v0.20.0 foundation  
**Base:** `test/v0.19.0-owner-module-control`  
**Candidate:** `agent/v0.20.0-game-adapter-sdk`

## Purpose

The Game Adapter SDK gives Khaos Nexus one safe contract for dedicated-server integrations instead of allowing every game module to invent its own status, moderation, timeout, error and credential behavior.

The foundation is transport-neutral. Rust WebRCON, Satisfactory HTTPS, 7 Days to Die Telnet, Minecraft Bedrock console/bridge, DayZ BattlEye RCon and future adapters can share the same operation contract while keeping protocol-specific code isolated.

## Core components

### Capability manifest

Every adapter declares:

- stable adapter ID;
- game ID and display name;
- transport type;
- adapter version;
- supported capabilities;
- minimum access role per capability;
- whether an operation is destructive;
- operation timeout;
- optional dry-run support;
- public-safe metadata.

The interface never guesses support from a game name. Controls should be enabled only when the adapter manifest declares the required capability.

### Standard capabilities

The initial contract recognizes:

- `status`
- `health`
- `info`
- `players`
- `metrics`
- `settings`
- `announce`
- `save`
- `backup`
- `kick`
- `ban`
- `unban`
- `shutdown`
- `restart`
- `stop`
- `raw`
- `game-data`
- `game-data-summary`
- `logs`
- `config-read`
- `config-write`

Namespaced capabilities such as `rust.queue` are allowed when a game exposes useful behavior that does not belong in the shared contract.

### Access and destructive-action policy

Default policy:

- viewer: status, health, players, information and metrics;
- operator: announcements, saves, backups and kicks;
- owner: bans, unbans, shutdown, restart, force stop, raw commands, configuration writes and full world-data access.

An adapter can strengthen a requirement but should not weaken destructive actions without an explicit reviewed manifest entry.

### Stable error model

Adapters return stable errors instead of leaking transport-specific exceptions into the desktop or Discord interfaces:

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

Each error receives a redacted fingerprint, adapter ID, game ID, capability, retryable flag and public-safe details.

### Execution envelope

Successful operations return:

- request ID;
- adapter and game IDs;
- capability;
- destructive flag;
- start and completion timestamps;
- duration;
- redacted result data.

The executor enforces capability support, role access, dry-run policy, bounded timeouts and error normalization before returning control to the caller.

### Registry

`GameAdapterRegistry` supports:

- registering a validated adapter definition;
- refusing duplicate IDs;
- replacing a definition during a controlled migration;
- listing public manifests;
- creating isolated adapter instances through factories;
- rejecting factories that return the wrong adapter identity.

### Fixture recorder

The optional fixture recorder writes bounded JSONL protocol samples for compatibility testing.

Safety properties:

- disabled unless a directory and explicit enable flag are supplied;
- passwords, tokens, API keys, authorization headers, cookies, credentials, session values, private keys and RCON secrets are redacted;
- nested depth, arrays, object fields and string sizes are bounded;
- oversized records become redacted previews;
- files rotate at a configured size;
- fixtures can be listed or cleared by adapter ID.

Fixtures must never be enabled automatically in a production build.

## Current transport bridge

`bot/game-adapters/current-server-adapter.cjs` wraps the existing `ServerConnection` implementation.

### Palworld REST

Declared capabilities:

- status, players, info, metrics and settings;
- announcements and saves;
- kick, ban and unban;
- graceful shutdown and force stop;
- game-data summary and Owner-only game-data access.

Raw commands are not declared for Palworld REST because the REST connection intentionally accepts only typed actions.

### ARK RCON

Declared capabilities:

- status and players;
- announcements and saves;
- kick and ban;
- shutdown/stop;
- Owner-only raw commands.

Unban is not advertised because the current ARK command map does not implement it.

### Generic and Palworld legacy RCON

Declared capabilities are derived from the current safe command map. Generic controls remain limited to the commands configured for that server entry.

## First migrated consumers

### Palworld desktop operations

The existing Palworld IPC handler retains all current confirmation and input validation, then executes through the adapter SDK. This adds a second capability, role, timeout and redaction boundary without removing current Owner safeguards.

### Discord status panels

Status and player checks now execute through the current-server adapter. Existing status snapshot rendering and privacy settings remain unchanged.

The service still supports injected connection factories, preserving deterministic tests and future recorded-protocol fixtures.

## Deliberate boundaries

This phase does not claim that Rust, Satisfactory, Bedrock, 7 Days to Die or other researched games are implemented.

This phase does not:

- expose the fixture recorder to normal users;
- enable raw commands on REST transports;
- bypass current module switches;
- weaken confirmation requirements;
- move credentials into renderer state;
- create a generic public network listener;
- enable Mobile Companion networking.

## Next implementation slice

After this foundation passes the full production and Windows audit:

1. add adapter diagnostics and capability inspection to the server detail interface;
2. migrate generic server test, scheduler and player-console paths through the executor;
3. create protocol fixture utilities for mocked WebSocket, HTTPS, Telnet and UDP transports;
4. implement the Rust WebRCON adapter behind its own Owner module switch;
5. add Rust status, players, queue, broadcast and moderation tests before exposing destructive actions.

# Khaos Nexus Rust WebRCON Adapter

**Version:** v0.21.0  
**Adapter ID pattern:** `current-rust-<server-id>`  
**Transport:** Rust WebRCON over `ws` or `wss`

## Purpose

This adapter provides a vanilla-safe Rust administration surface through the shared Khaos Nexus Game Adapter SDK. It does not assume that uMod, Oxide, Carbon, or any community plugin is installed.

## Rust server requirements

Rust must be launched with WebRCON enabled. A typical server configuration includes:

```text
+rcon.web 1
+rcon.port 28016
+rcon.password "replace-with-a-strong-password"
```

The configured RCON port is separate from the game port and query port. Restrict the RCON port with the server firewall or hosting-provider network controls.

Official references:

- https://wiki.facepunch.com/rust/Creating-a-server
- https://wiki.facepunch.com/rust/Creating-a-server#rcon
- https://wiki.facepunch.com/rust/Useful_Console_Commands

## Transport security

### `ws`

Standard Rust WebRCON is an unencrypted WebSocket connection. It should only be used across a trusted private network, VPN, secure tunnel, or tightly restricted firewall path.

### `wss`

Khaos Nexus supports `wss` when the administrator supplies a trusted TLS reverse proxy in front of Rust WebRCON. The application does not disable certificate validation or provide a global insecure-TLS switch.

## Protocol behavior

Each request opens a bounded WebSocket session and sends:

```json
{
  "Identifier": 12345,
  "Message": "serverinfo",
  "Name": "Khaos Nexus"
}
```

The adapter:

- generates a request identifier;
- ignores unrelated or unsolicited packets;
- accepts only a response with the matching identifier;
- limits response size;
- applies timeouts and cancellation;
- rejects malformed JSON;
- removes protected credentials from errors;
- closes the request socket after completion.

A one-request connection model is used for predictable cleanup and to avoid maintaining a long-lived password-bearing socket while the application is idle.

## Capability manifest

| Capability | Minimum role | Rust command | Notes |
|---|---:|---|---|
| `status` / `info` | Viewer | `serverinfo` | Parses server name, players, queue, joining, entities, uptime, FPS, map, and version where returned. |
| `players` | Viewer | `playerlist` | Parses JSON and retains public-safe name, Steam64 ID, ping, and connected time. IP addresses are discarded. |
| `announce` | Operator | `say` | Typed message; line breaks and semicolon chaining rejected. |
| `save` | Operator | `save` | Requests a world save. |
| `kick` | Operator | `kick` | Requires Steam64 ID and a bounded reason. |
| `ban` | Owner | `banid` | Requires Steam64 ID, bounded display label, and reason. |
| `unban` | Owner | `unban` | Requires Steam64 ID. |
| `shutdown` | Owner | `save`, then `quit` | Saves before shutdown. An expected WebSocket close from `quit` counts as completion. |
| `stop` | Owner | `quit` | Immediate shutdown request. |
| `raw` | Owner | supplied command | Single-line command only. Discord raw access is restricted to the configured Owner account. |

Capabilities are declared explicitly. Rust does not advertise Palworld-only metrics/settings/world-data endpoints or community-plugin features.

## Desktop integration

Rust is configured in **Game Servers**:

1. Choose **Rust Dedicated Server**.
2. Enter a server name.
3. Enter only the host or IP; do not combine host and port.
4. Enter the WebRCON port.
5. Choose `ws` or `wss`.
6. Enter the RCON client name, normally `Khaos Nexus`.
7. Enter the protected WebRCON password and save.

The Rust operations panel provides status, player list, save, announcement, raw Owner command, and confirmed shutdown controls. Kick, ban, and unban are also available through the shared Players & Moderation workspace.

## Owner module behavior

`rust-server-operations` depends on `game-server-control`.

When the Owner disables Rust Server Operations:

- desktop Rust actions are blocked;
- Rust is excluded from Discord server autocomplete and actions;
- player-console Rust entries disappear;
- Rust status panels stop refreshing;
- automated health and maintenance checks skip Rust;
- schedules skip Rust targets;
- existing credentials and configuration remain stored;
- the Game Servers editor remains accessible for repair.

Re-enabling the module restores operations without deleting saved configuration.

## Discord behavior

Rust uses the shared game commands only when the selected server declares the matching capability. Palworld-only commands do not offer Rust servers, and unsupported operations are not exposed through autocomplete.

Discord operations execute through the Game Adapter SDK with protected credentials supplied as explicit redaction values. Raw console execution requires the configured Khaos Nexus Owner user ID even when another Discord member has Administrator permission.

## Status panels

Rust public status panels may display:

- online/degraded/offline state;
- current and maximum players;
- queued and joining counts;
- map;
- version;
- server FPS;
- uptime;
- entity count;
- optional public-safe player names.

The panel never displays player IP addresses or the WebRCON password.

## Deliberate boundaries

- No Rust+ companion protocol integration is included in v0.21.0.
- No uMod/Oxide/Carbon commands are assumed.
- No plugin installation or file-system access is required.
- Vanilla WebRCON has no durable delayed-shutdown workflow; use the Khaos Nexus Server Scheduler for warnings and countdowns.
- `wss` requires an administrator-managed trusted TLS endpoint.
- Stable publication remains blocked until Owner-device testing confirms the real hosted-server connection and permissions.
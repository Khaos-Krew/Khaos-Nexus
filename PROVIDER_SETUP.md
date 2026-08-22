# Game Service Provider Setup

Nexus 0.1 keeps Sentinel independent from game-specific transports. Each module can be connected to a backend game service through `config.json`.

Example:

```json
{
  "modules": {
    "ark": {
      "enabled": true,
      "channelId": "YOUR_ARK_DISCORD_CHANNEL_ID",
      "provider": {
        "type": "http",
        "baseUrl": "http://127.0.0.1:4101",
        "tokenEnv": "NEXUS_ARK_SERVICE_TOKEN"
      }
    }
  }
}
```

The configured service receives:

```text
POST /actions/<action-id>
Authorization: Bearer <service token>   (when configured)
X-Nexus-Role: viewer | operator | owner
X-Nexus-Actor: <Discord user id>
Content-Type: application/json
```

Body:

```json
{ "payload": {} }
```

The service should respond with JSON. A successful response can be either `{ "data": ... }` or a direct JSON value/object.

## Sentinel channel binding

Set each module's `channelId` to the relevant Discord text channel. Sentinel creates one persistent console message, remembers its message ID in `data/sentinel-state.json`, edits it on restart, and recreates it if the saved message no longer exists.

## Current module IDs

- `ark`
- `palworld`
- `minecraft`
- `warframe`
- `division2`
- `rust`
- `satisfactory`
- `idleon`
- `dnd` (backend-first, Veyra presentation by default)

## Security

- Keep Discord and service tokens in environment variables, not `config.json`.
- Nexus Backend refuses non-loopback binding when its backend service token is missing.
- Owner/destructive actions are rejected by Nexus Backend until an explicit confirmation has been supplied.
- Provider services should still enforce their own authentication and least-privilege controls.

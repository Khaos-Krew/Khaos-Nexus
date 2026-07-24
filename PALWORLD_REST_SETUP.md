# Palworld REST API setup

Khaos Nexus 0.7.0 uses Palworld's REST API by default for Palworld 1.0 servers. Legacy RCON remains available as an explicit fallback.

## Required server values

- Host/IP: the IP or hostname only. Khaos Nexus also accepts a pasted `host:port` and separates it automatically.
- REST API port: the port labelled **REST API Port** by the host. This is not the game port.
- Connection type: **Palworld REST API**.
- Protocol: normally `http`; use `https` only when the host or a secured reverse proxy provides TLS.
- API username: normally `admin`, but it is configurable because hosting providers may use a different username.
- API base path: `/v1/api`.
- Password: the server's `AdminPassword`, not the player join password.

For the server shown during first-run testing:

- Host: `109.230.208.21`
- Game port: `17080`
- REST API port: `17083`

## Server configuration

A self-hosted server requires these settings in the active `PalWorldSettings.ini`:

```ini
RESTAPIEnabled=True
RESTAPIPort=8212
AdminPassword="replace-this"
```

Restart the Palworld server after changing its configuration.

## Security

Pocketpair states that the REST API is not designed to be exposed directly to the internet. Prefer a hosting-provider protected endpoint, firewall allowlist, VPN, private network, or authenticated TLS reverse proxy. Never reuse the AdminPassword elsewhere.

## Supported operations

Khaos Nexus supports:

- server information
- connected player list
- server settings
- performance metrics
- announcements
- world save
- kick, ban, and unban
- graceful delayed shutdown
- emergency force stop
- world actor snapshot summary and JSON export

The same transport is used by desktop health checks, Safe Recovery, Maintenance Mode, and Discord commands.

## Validation note

The clean `agent/palworld-rest-v0.7.0` branch is the canonical validation branch for this release after the repository rename.

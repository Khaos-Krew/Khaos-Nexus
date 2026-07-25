# Pterodactyl Hosted Server Control

Khaos Nexus v0.17.0 adds provider-backed power control through the Pterodactyl Client API.

## Requirements

- A Pterodactyl panel account that owns the server or has the required subuser permissions.
- A Client API key created from that account.
- The public or local URL of the Pterodactyl panel.

Use a Client API key (`ptlc_...`) rather than placing a password in Khaos Nexus. Client keys created by current Pterodactyl versions can access the Client API for servers visible to that account.

## Create a Client API key

1. Sign in to the Pterodactyl panel.
2. Open the account API-credentials page.
3. Create a new Client API key for Khaos Nexus.
4. Copy the key immediately.
5. In Khaos Nexus, open **Hosted Servers** and select **New Provider**.
6. Enter the panel URL and save the key in the protected Client API key field.
7. Select **Test Connection**.

The key is encrypted through Windows secure storage. After it is saved, the renderer receives only a `hasToken` flag and never receives the key again.

## Secure URLs

Remote panels must use HTTPS. HTTP is allowed automatically for `localhost` and `127.0.0.1`. The **Allow insecure HTTP** option exists only for a trusted local-network panel and should not be used over the public internet.

The following entries are normalized to the panel root:

- `https://panel.example.com`
- `https://panel.example.com/`
- `https://panel.example.com/api/client`

Panel URLs containing embedded usernames or passwords are rejected.

## Available controls

- **Start** — Operator or Owner.
- **Restart** — Operator or Owner.
- **Stop** — Operator or Owner.
- **Emergency Kill** — Owner only and requires typing the exact server name.

Khaos Nexus sends only the typed Pterodactyl power signals `start`, `restart`, `stop`, or `kill`. It does not expose arbitrary API paths or raw console commands through this workspace.

## Server inventory and resources

The Client API is used to discover every server visible to the saved account. For each server Khaos Nexus requests the resource endpoint and displays safe operational fields such as:

- current state;
- CPU usage;
- memory usage;
- disk usage;
- network totals;
- uptime;
- configured resource limits;
- provider and node labels.

Pterodactyl identifiers are retained only in the main process. The renderer receives a short-lived random action token for each server card. Refreshing the inventory invalidates all previous tokens.

## Permissions

The Pterodactyl account and API key must have permission for the requested server action. A server shared as a subuser can appear in discovery while still denying a power action if the required Pterodactyl permission is missing. Khaos Nexus reports that denial without exposing the API key.

## Rate limits

Automatic refresh is configurable per provider. Avoid overly aggressive refresh intervals when an account can see many servers because each inventory refresh also requests resources for discovered servers. Pterodactyl may return HTTP 429 when its Client API rate limit is reached; Khaos Nexus surfaces a safe retry message.

## Owner-test sequence

1. Add a provider and test the connection.
2. Refresh the hosted inventory.
3. Confirm names, states, and resource values.
4. Test **Start** or **Restart** on a non-production server.
5. Confirm the action appears in Power Action History.
6. Test **Stop** only after confirming the game has saved.
7. Reserve **Emergency Kill** for a frozen process that cannot stop normally.

The emergency kill action may cause world or file corruption. It is intentionally Owner-only and requires an exact-name confirmation.

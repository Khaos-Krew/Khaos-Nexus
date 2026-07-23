# Discord Desktop Login Setup

Khaos Nexus uses Discord OAuth2 Authorization Code with PKCE. The operator signs in through their normal browser; Discord passwords are never entered into or handled by Khaos Nexus.

## Discord Developer Portal

Use the same Discord application that owns the Khaos Nexus bot.

1. Open the application in the Discord Developer Portal.
2. Open **OAuth2**.
3. Enable **Public Client**.
4. Add this exact Redirect URI:

   `http://127.0.0.1:43119/callback`

5. Save the application changes.
6. Copy the **Application ID / Client ID**.

No Discord client secret is required by the desktop app. Do not paste the client secret into Khaos Nexus.

## Khaos Nexus setup

1. Open **Discord** in Khaos Nexus.
2. Keep the existing Discord server ID and owner user ID configured.
3. In **Sign in with Discord**, paste the Application ID / Client ID.
4. Keep the Redirect URI as `http://127.0.0.1:43119/callback`.
5. Add additional trusted operator Discord user IDs separated by commas. Add the user's wife here so her login is accepted.
6. Select **Save Login Setup**.
7. Select **Sign in with Discord**.
8. Approve the `identify` and `guilds` scopes in the browser.
9. Return to Khaos Nexus and confirm the account says **Authorized operator**.

## Requested scopes

- `identify`: reads the signed-in user's Discord ID, username, display name, and profile basics.
- `guilds`: checks whether the signed-in user belongs to the configured Khaos Nexus Discord server and displays the number of servers available to the account.

The desktop login does not request email, messages, direct messages, contacts, or permission to act as the user.

## Operator allowlist

The existing **Owner Discord user ID** is always treated as an allowed operator. Additional operator IDs can be added for trusted people such as the user's wife.

When an account signs in:

- allowed ID: the account displays **Authorized operator**;
- unlisted ID: the account is identified but displays **Not authorized**;
- empty allowlist and empty owner ID: the signed-in account is accepted, which is useful only during first-time setup.

## Session security

- OAuth uses a random `state` value to prevent login-request substitution.
- OAuth uses PKCE SHA-256 so the authorization code cannot be exchanged without the temporary verifier held by the desktop app.
- The callback listens only on `127.0.0.1` using fixed local port `43119`.
- Access and refresh tokens are encrypted with Windows protected storage.
- Tokens are included only inside the Windows-encrypted backup blob and are redacted from diagnostics.
- Expired sessions refresh automatically when Khaos Nexus starts.

## Troubleshooting

### Redirect URI mismatch

Confirm the Redirect URI in the Developer Portal and Khaos Nexus match exactly, including `http`, `127.0.0.1`, port `43119`, and `/callback`.

### Callback port unavailable

Close another Khaos Nexus instance or any application using local port `43119`, then start the login again.

### Account is not authorized

Copy the account's Discord user ID and add it to **Additional operator Discord user IDs**, or set it as the Owner Discord user ID.

### Session cannot restore

Select **Sign Out**, then sign in again. A revoked or expired refresh token cannot be recovered locally.

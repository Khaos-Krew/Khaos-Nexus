# Khaos Nexus Discord Studio

Khaos Nexus 0.10.0 adds a local Embed Studio and persistent Discord game-server status panels. Templates, panel configuration and published-message references are stored in the normal Khaos Nexus configuration and included in verified backups.

## Discord bot permissions

The bot needs these permissions in each channel used by Discord Studio:

- View Channel
- Send Messages
- Embed Links
- Read Message History

Announcement channels are supported when the bot can publish ordinary messages in that channel. Forum and media channels are intentionally excluded from the channel picker in this release.

## Embed Studio

1. Open **Discord Studio** from the sidebar.
2. Select **Load Channels**.
3. Choose a built-in template or create a new template.
4. Configure the message content, title, description, color, images, footer, fields and link buttons.
5. Review the live Discord-style preview.
6. Save the template.
7. Choose a preview channel and select **Send Discord Preview**.

Previews are real Discord messages. Khaos Nexus disables generated mentions, so text such as `@everyone` is not converted into a notification.

### Server-status placeholders

- `{{server.name}}`
- `{{server.game}}`
- `{{server.connection}}`
- `{{server.version}}`
- `{{status.label}}`
- `{{status.summary}}`
- `{{status.uptime}}`
- `{{status.performance}}`
- `{{status.checkedAt}}`
- `{{players.current}}`
- `{{players.max}}`
- `{{players.summary}}`

## Persistent status panels

1. Open the **Server Status Panels** tab.
2. Create a panel.
3. Select a configured game server.
4. Select a Discord channel and an embed template.
5. Choose a refresh interval of at least one minute.
6. Save the panel.
7. Select **Publish / Update**.

Khaos Nexus stores the Discord message ID and edits the same message on future refreshes. If the message is deleted manually, a later publish or refresh creates a replacement and stores the new message ID.

Enabled published panels are checked in the background. Only panels that are due are refreshed. **Refresh All Panels** and **Refresh Now** are available for deliberate operator testing.

## Public-safety boundary

Status-panel payloads do not include:

- RCON passwords
- Palworld AdminPasswords
- Discord tokens
- server IP addresses or hostnames
- player platform IDs
- moderation actions

Player display names and public-safe counts may be shown when the panel's player option is enabled. Connection failures publish a red offline state with a sanitized explanation instead of exposing protected configuration.

## Removing a panel

- **Delete Discord Message** removes the published message but keeps the local panel configuration.
- **Remove Configuration** removes the local configuration but does not silently delete a Discord message.

This separation prevents accidental loss and makes each external change deliberate.

## Access roles

- Viewer: inspect templates, panels and runtime health.
- Operator: create, edit, preview, publish, refresh and remove Discord Studio content.
- Owner: all Operator functions plus ownership of the protected bot and server configuration.

## Stable release validation

The release branch rebuilds v0.10.0, reruns the complete tests and syntax checks, verifies the installer, portable executable, update metadata and checksum manifest, and publishes the release only after every gate succeeds.

# Nexus Sentinel — Windows Test Roadmap

## Product target

Nexus Sentinel is the Windows-first Khaos Nexus desktop command center for:

- Discord bot supervision and operator identity
- Discord Studio, automation, roles, organization, logging, observability, and status panels
- Palworld server configuration, status, players, settings, metrics, saves, announcements, moderation, shutdown, and advanced console access
- Owner/operator access control
- Backups, recovery, diagnostics, logs, readiness, and update safety
- Owner-controlled runtime modules

The test product is local-first. Protected credentials remain in Windows-protected storage. The active game-server scope is Palworld only.

---

## Release gates

A Windows test artifact is acceptable only when all of these gates pass:

1. Source syntax validation.
2. Sentinel/Discord/Palworld regression tests.
3. Installer and portable Windows builds are produced.
4. The packaged portable executable launches in Windows CI.
5. The protected preload bridge becomes available.
6. The configuration service loads.
7. Renderer feature bundles finish loading.
8. The final rendered product identifies itself as Nexus Sentinel.
9. No deferred product view is visible in the final navigation.
10. The server editor exposes Palworld only.
11. No critical startup-health failure remains.
12. The final artifact name clearly identifies the acceptance build.

A green compiler/build step by itself is not considered sufficient.

---

# Phase 0 — Product boundary and first launch

**Goal:** Make sure the application the tester opens is actually Nexus Sentinel, not the old all-in-one shell.

### Required behavior

- Product subtitle: `Discord + Palworld Control Center`.
- Bot identity in desktop copy: `Nexus Sentinel`.
- Only active Sentinel workspaces appear.
- Palworld is the only game selectable in server setup.
- Deferred module configuration is preserved locally but cannot be enabled accidentally.
- Test builds cannot consume the legacy monolithic release feed.
- Installer and portable builds use explicit Sentinel acceptance names.

### Test sequence

- **S0.1** Launch installed build.
- **S0.2** Launch portable build separately.
- **S0.3** Confirm the sidebar contains no deferred-product workspaces.
- **S0.4** Open Palworld server editor and confirm the game selector is locked to Palworld.
- **S0.5** Close/reopen and confirm configuration survives.
- **S0.6** Launch a second instance and confirm the existing window is revealed rather than creating a conflicting process.

### Acceptance

Pass when the installed and portable builds both reach a responsive Sentinel dashboard with the same functional product boundary.

---

# Phase 1 — Command Center and Readiness

**Goal:** Make the first screen tell the operator what works, what needs setup, and where to test next.

### Command Center

The dashboard should show:

- Sentinel runtime state
- Discord configuration state
- Number of configured Palworld servers
- Module status counts
- Current desktop access role
- Direct test-path buttons for Discord, Palworld, Readiness, Modules, and owner diagnostics

### Readiness Center

Status must update from live application state rather than remaining a static checklist.

Checks include:

- Windows protected storage
- configuration loading
- supervised bot restart setting
- verified backup state
- Discord bot token
- Discord guild ID
- owner Discord user ID
- Discord OAuth application ID and redirect
- trusted operator configuration
- current operator login
- automatic backups
- self-healing
- access control
- recovery path
- configured Palworld servers
- Palworld credentials/address readiness
- GitHub reporting configuration when enabled

### Safe test rules

- `Run Safe Local Self-Test` must not contact Discord, GitHub, or a game server.
- Live checks happen only after the operator explicitly selects them.
- Maintenance Mode is never part of an automatic readiness test.

### Test sequence

- **S1.1** Open Command Center and compare its state to the actual saved configuration.
- **S1.2** Open Readiness Center.
- **S1.3** Run Safe Local Self-Test.
- **S1.4** Verify a backup is created/verified.
- **S1.5** Change a relevant setting and confirm readiness updates without restarting the app.
- **S1.6** Use each explicit live test only after the target service is configured.

### Acceptance

Pass when readiness accurately follows live state and never performs a destructive or hidden external action.

---

# Phase 2 — Discord identity and Nexus Sentinel runtime

**Goal:** Prove the dedicated main bot can be configured, started, supervised, and recovered from the desktop.

### Owner setup

- Protected Discord bot token
- Guild/server ID
- Owner Discord user ID
- OAuth application/client ID
- loopback redirect URI
- additional trusted operator IDs

### Desktop behavior

- Save configuration without exposing stored token afterward.
- `Save and Start` starts Nexus Sentinel through the supervised worker boundary.
- Start/stop/restart controls reflect the real process state.
- Bot crash/error state is surfaced in logs and diagnostics.
- Operator OAuth identifies the person using the desktop; it does not replace the bot token.

### Discord slash-command baseline

- `/ping`
- `/health`
- `/status`
- `/players`
- `/settings`
- `/metrics`
- `/snapshot`
- `/saveworld`
- `/broadcast`
- `/kick`
- `/ban`
- `/unban`
- `/shutdown`
- `/forcestop`
- `/rcon`
- `/listservers`
- `/managerrestart`

Destructive commands remain permission-guarded.

### Test sequence

- **S2.1** Save Discord setup.
- **S2.2** Sign in as owner through Discord OAuth.
- **S2.3** Start Sentinel.
- **S2.4** Run `/ping` and `/health`.
- **S2.5** Stop and restart from desktop.
- **S2.6** Restart through `/managerrestart` only after normal restart succeeds.
- **S2.7** Confirm token text is never re-displayed by the application.

### Acceptance

Pass when the same dedicated Sentinel worker is used by desktop start, restart, crash recovery, and Discord command handling.

---

# Phase 3 — Discord community operations

**Goal:** Validate the current Discord management feature set without requiring game-server actions.

### Active workspaces/modules

- Discord Runtime
- Embed Studio
- Role Menus
- Color Roles
- Discord Organization
- Discord Logs & Audit
- Discord Observability
- Admin Command Center

### Required safety

- Existing channels/categories should be reused when configured to do so.
- Rerunning organization automation must avoid duplicate structures.
- Role menus use explicit button-driven assignment.
- Color roles remain below protected staff/management roles.
- Community/management role delegation must not transfer ownership.
- Audit/observability output must not contain protected credentials.

### Test sequence

- **S3.1** Open Discord Studio and render a preview.
- **S3.2** Publish/update a safe test panel.
- **S3.3** Create/reconcile a test role menu.
- **S3.4** Verify color-role ordering.
- **S3.5** Re-run Discord organization reconciliation and confirm no duplicates.
- **S3.6** Verify audit/observability events are generated.
- **S3.7** Review redacted output for secrets.

### Acceptance

Pass when repeated Discord automation is idempotent, recoverable, and permission-safe.

---

# Phase 4 — Palworld server registration and read-only health

**Goal:** Prove Palworld connectivity before enabling destructive operations.

### Supported connection surface

- Palworld REST management where configured
- Legacy RCON fallback/advanced console where configured

### Read-only tests first

- server connection test
- status
- players
- settings
- metrics
- snapshot summary
- status-panel refresh

### Test sequence

- **S4.1** Add one Palworld server.
- **S4.2** Save credentials in protected storage.
- **S4.3** Run desktop connection test.
- **S4.4** Run `/status`.
- **S4.5** Run `/players` and confirm no player IP addresses are exposed.
- **S4.6** Run `/settings`, `/metrics`, and `/snapshot` where supported.
- **S4.7** Restart the desktop and confirm server configuration persists.

### Acceptance

Pass when all configured servers exposed by Sentinel are Palworld targets and read-only state can be retrieved without leaking credentials or private network/player information.

---

# Phase 5 — Palworld guarded operations

**Goal:** Validate state-changing actions in increasing order of risk.

### Low-risk operations

1. Save world
2. Broadcast announcement

### Moderation

3. Kick test player
4. Ban test account
5. Unban test account

### High-risk operations

6. Graceful delayed shutdown
7. Force stop only with explicit confirmation
8. Raw RCON/console only under owner/admin guard

### Test rules

- Always validate read-only connectivity first.
- Destructive operations must have explicit operator/administrator permission.
- Force stop requires confirmation.
- Raw console is treated as advanced owner-level control in the UI.
- Each action should create an audit/log record.

### Acceptance

Pass when actions succeed against a real test server, failures are understandable, and failed requests do not leave the desktop in a false-success state.

---

# Phase 6 — Players, moderation, and Discord status panels

**Goal:** Make the live operational surfaces reliable enough for everyday use.

### Players & Moderation

- live player list
- refresh
- server association
- guarded moderation actions
- clear reason/error reporting
- no IP address exposure

### Status Panels

- create/publish panel
- persistent message identity
- refresh existing message instead of duplicating
- public-safe fields only
- offline server handling
- recovery when a Discord message/channel is missing

### Test sequence

- **S6.1** Open Players with server online.
- **S6.2** Refresh several times and check for duplicate/stale entries.
- **S6.3** Publish a status panel.
- **S6.4** Refresh it repeatedly and confirm the same Discord message is updated.
- **S6.5** Stop the Palworld server and verify offline state.
- **S6.6** Bring it back online and confirm recovery.

### Acceptance

Pass when player/status surfaces can remain open and update repeatedly without duplicate Discord messages or stale UI state.

---

# Phase 7 — Runtime Modules

**Goal:** Replace the old migration-dashboard mental model with simple operational state.

### User-facing status vocabulary

- **Operational** — implemented, enabled, dependencies satisfied
- **Migrate in progress** — usable foundation exists but the current module is not feature-complete
- **Disabled** — owner intentionally turned it off
- **Blocked** — enabled but an active dependency is unavailable

No migration percentage, website route map, or migration checklist is required in the normal Sentinel UI.

### Owner behavior

- Implemented/current-scope modules may be toggled on/off.
- Deferred modules are not offered for activation.
- Disabling a dependency immediately moves dependents to Blocked.
- Re-enabling the dependency restores effective operation without deleting stored configuration.

### Test sequence

- **S7.1** Open Modules and confirm only current Sentinel modules appear.
- **S7.2** Disable a low-risk implemented module and confirm status becomes Disabled.
- **S7.3** Re-enable it and confirm Operational.
- **S7.4** Disable a dependency and verify dependent module becomes Blocked.
- **S7.5** Restore dependency and confirm recovery.

### Acceptance

Pass when module state is understandable without development/migration terminology and owner toggles never expose deferred products.

---

# Phase 8 — Owner access and Application Monitor

**Goal:** Keep sensitive diagnostics and reporting under owner control while preserving operator access to normal runtime tasks.

### Owner-only Application Monitor actions

- settings
- GitHub token
- connection verification
- queue delivery
- queue clearing
- current-error delivery
- opening the last generated issue from the Monitor surface

Automatic internal renderer-error capture may still record redacted local diagnostics before owner login; that is not equivalent to granting Monitor UI/reporting authority.

### Operator permissions remain separate

Operators may still perform explicitly delegated normal bot/Palworld operations according to the desktop access policy. Premium/community roles never imply desktop administrative access.

### Test sequence

- **S8.1** Sign in as owner and confirm Application Monitor is visible.
- **S8.2** Verify connection with a valid token.
- **S8.3** Sign in as non-owner operator and confirm the Monitor workspace is hidden.
- **S8.4** Attempt Monitor IPC/action through normal UI paths and confirm owner rejection.
- **S8.5** Return to owner account and confirm access is restored.

### Acceptance

Pass when Application Monitor is inaccessible to non-owner identities at both renderer and backend boundaries.

---

# Phase 9 — Backups, recovery, logs, and diagnostics

**Goal:** Make failures recoverable without exposing secrets.

### Backups

- manual verified backup
- automatic backup scheduling
- retention
- restore
- pre-update backup before production update installation

### Recovery

- Safe Recovery
- access-control lockout recovery
- renderer/interface watchdog
- crash diagnostics
- bot restart supervision

### Logs/diagnostics

- local runtime logs
- clear logs under owner control
- redacted diagnostics export
- error fingerprinting
- queued reporting when offline

### Test sequence

- **S9.1** Create manual backup.
- **S9.2** Export backup and verify format.
- **S9.3** Change a harmless setting, restore backup, and verify rollback.
- **S9.4** Export diagnostics and inspect for Discord tokens/passwords.
- **S9.5** Exercise Safe Recovery.
- **S9.6** Confirm logs remain readable after restart.

### Acceptance

Pass when configuration can be restored and exported diagnostic material contains no protected credential value.

---

# Phase 10 — Update experience

**Goal:** Move from installer-style updates to a smoother protected in-app update flow after the split product has its own production release identity.

### Current test-build rule

The split Sentinel acceptance build does not consume the legacy monolithic update feed. This is intentional.

### Production roadmap

1. Give Sentinel its own release channel/tag convention.
2. Check/download update in background without replacing the running version unexpectedly.
3. Verify asset identity/integrity before staging.
4. Create and verify a backup automatically.
5. Apply update on explicit owner action or controlled restart.
6. Preserve the previous executable/release as rollback target.
7. Restore the previous version automatically if startup-health acceptance fails after update.
8. Show concise release notes and update status in Settings/Command Center.

### Acceptance

Production updater work is complete only when an update can be installed and rolled back without rerunning a full setup workflow manually or losing configuration.

---

# Deferred expansion after current acceptance

These remain outside the current Windows acceptance build and should not delay Discord + Palworld readiness:

- additional game adapters
- additional community modules
- advanced chat relay
- leveling/tickets
- patch-note automation
- profile/achievement/community directory features
- future Sentinel intelligence/assistant integration

Stored configuration for deferred modules should remain recoverable where practical, but deferred modules must stay disabled and absent from the current operational UI.

---

# Home test order — condensed

1. **Launch** — confirm correct Sentinel UI and no deferred views.
2. **Readiness** — run safe local self-test.
3. **Discord setup** — token, guild, owner, OAuth.
4. **Sentinel runtime** — start, `/ping`, `/health`, restart.
5. **Discord features** — Studio/roles/organization/audit.
6. **Palworld read-only** — connection, status, players, settings, metrics.
7. **Palworld low-risk writes** — save and broadcast.
8. **Moderation** — kick/ban/unban only with a safe test account.
9. **Shutdown controls** — graceful first; force stop only if intentionally testing it.
10. **Status panels** — repeated refresh/offline/recovery.
11. **Modules** — operational/disabled/blocked behavior.
12. **Owner access** — verify Application Monitor is owner-only.
13. **Backup/restore** — prove recovery.
14. **Diagnostics** — export and inspect redaction.

If any step fails, stop at that phase and retain the screenshot/error ID/log output. Later phases should not be used to hide or work around an earlier acceptance failure.

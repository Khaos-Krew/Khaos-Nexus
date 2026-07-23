# Khaos Nexus desktop migration roadmap

Khaos Nexus is moving every useful website capability into one local-first Windows application. The desktop application is the primary operator surface; shared and public services remain optional and are used only when a feature genuinely requires public access or synchronization.

## Design rules

- One futuristic Nexus shell with separate workspaces instead of a wall of unrelated pages.
- Red, black and metallic styling with restrained holographic signal accents.
- Owner, Operator and Viewer permissions are enforced in the Electron main process.
- Dangerous actions require confirmation, audit context and protected credentials.
- Each module is isolated so one failing integration cannot crash the Discord bot or desktop manager.
- Local data, backups and export come first. Cloud dependencies must be optional and explicit.
- Public views expose only public-safe fields.
- The private Dungeons & Dragons workspace remains owner-hidden until its complete release gate is passed.

## Migration gates

Every module uses the same six gates:

1. Feature inventory
2. Local data model
3. Desktop services
4. Nexus interface
5. Access and audit
6. Validation and release

Progress and notes are stored in the normal Khaos Nexus configuration and are included in verified backups.

## Workspaces

### Operations

- Game Server Control
- Palworld Operations
- ARK Server Operations
- Server Scheduler
- Players and Moderation
- Server Status Panels
- Hosted server control
- Additional game adapters
- Operator Console
- Backup and Update Center

### Discord

- Discord Runtime
- Embed Studio
- Module, category and channel automation
- Role menus
- Color roles
- Role sync and senior staff
- Discord logs and audit
- Chat relay
- Leveling and support tickets
- Patch-note automation

### Community

- Communities directory
- Groups
- Events
- Looking for Group
- Recruitment
- Nexus profiles
- Achievements
- Supporter status

### Companions

- ARK Companion
- Palworld Companion
- Warframe Companion
- IdleOn Companion
- Minecraft, 7 Days to Die, Conan Exiles and Rust companions

### Creator and Content

- Streamer Toolkit
- Live hub and overlays
- Wallpapers and asset library
- Guide and knowledge center
- Support and feedback
- Merch and supporter links

### Private Administration

- Admin Command Center
- Analytics
- System health
- Audit log
- Setup checklist
- Feedback and content administration
- Owner-hidden Dungeons & Dragons workspace

## Production order

1. Module registry, migration center and removal of retired-platform language.
2. Embed Studio and persistent status panels.
3. Discord role menus, color roles, category automation and logs.
4. Server scheduler, cross-server players and hosted server provider adapters.
5. Community directory, groups, events, LFG, recruitment and profiles.
6. Companion workspaces, starting with ARK and Palworld, then Warframe and IdleOn.
7. Streamer, wallpapers, guides, support and feedback.
8. Private admin consolidation and full Dungeons & Dragons completion.
9. Optional public portal and shared-service extraction only for features that need public access.

## Source inventory

The inventory was derived from the original `Khaos-Krew/chaos-nexus-hub` route map and its full refresh branch. The desktop module catalog stores the originating routes for traceability and to prevent website functions from being silently omitted.

## Validation

The v0.9.0 foundation is distributed only after the complete catalog tests, existing application tests, syntax validation and Windows installer/portable packaging workflow pass.

# Nexus AI Operations Completion — v0.36.0

## Scope

This change completes issue #184 on top of the released v0.35.2 desktop source. It does not publish a release.

## Implemented behavior

- Nexus AI update checks reuse the existing shared Khaos Nexus scheduler timer. No AI-owned timer or second scheduler is introduced.
- Monitor settings, source definitions, review-only Discord subscriptions, last/next run state, outcomes, and bounded history persist in local desktop configuration.
- A due scheduled run writes its next-run claim before contacting the AI sidecar, preventing duplicate execution after restarts or overlapping scheduler ticks.
- The primary supervised Discord bot exposes `/nexus status`, `ask`, `updates`, `check`, `plan`, `subscribe`, and `unsubscribe`.
- Discord requests are proxied through the desktop main process. The bundled AI Core endpoint and per-launch service token never enter bot bootstrap, renderer state, logs, diagnostics, or Discord output.
- Owner/administrator checks protect manual polling, planning, and subscription changes. All commands are guild-bound, ephemeral, mention-safe, bounded, rate-limited, and audited.
- The Nexus AI desktop workspace now includes service readiness, cadence, last/next run, sources, subscriptions, recent history, settings, source management, and a manual check.

## Authority and safety

- Nexus AI Core remains advisory-only.
- Maintenance plans cannot execute actions.
- Scheduled and manual checks create reviewable local results and never automatically post a public Discord announcement.
- Nexus AI cannot call D&D capabilities or receive campaign context.
- Discord command registration and interactions remain owned by the existing supervised desktop gateway.
- No direct game-server, updater, permission, scheduler, download, or maintenance execution path is exposed to AI output.

## Validation required before release

- Production dependency audit.
- Complete Node test suite and repository checks.
- Bundled D&D AI and Nexus AI Core build verification.
- Windows installer and portable packaging.
- Packaged startup readiness with both AI services.
- Owner-device validation for Discord registration and the desktop monitor workflow.
- Separate explicit Owner authorization before any tag, updater publication, or public release.

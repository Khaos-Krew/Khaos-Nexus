# Sentinel Owner Input & Blockers

This file is the authoritative queue for items that cannot be resolved safely in code without owner input, live credentials, or explicit approval. Sentinel roadmap work should continue past non-blocking items wherever possible.

## Owner Input Needed

- **None for the current S1 pure-code implementation slice.**
- **Live Discord acceptance testing:** a live guild connection and credentials will be required when the control plane reaches end-to-end Discord validation. Secrets must never be committed to the repository.
- **Merge/release approval:** merging this feature branch into the stabilization/release path is treated as a high-impact action and remains owner-gated after CI and acceptance checks are complete.
- **Legacy surface retirement:** old reaction-role/embed-bot mechanisms must not be disabled or removed until Sentinel adoption is verified in the live guild and the owner approves retirement.
- **Final hub banner assets:** the planned centralized banner manifest/assets are not present on this source branch. Code may ship with a safe no-banner fallback, but final artwork assignment requires the approved asset package when available.

## Active Blockers

- **None currently blocking pure-code roadmap implementation.**

## Deferred Operational Prerequisites

- **Supabase:** the Khaos Nexus Supabase project must be available/unpaused before live backend acceptance testing that depends on it.
- **Discord live E2E:** live guild IDs and authorized bot/runtime credentials are required for final end-to-end adoption tests. Pure planning/rendering/executor tests do not require them.

## Resolved

- Stale README/mobile-workspace CI assertion corrected.
- Health/status-panel blocker cleared: full branch CI is green, and the Sentinel health suite enforces exactly Online, Offline, and Maintenance plus the approved deterministic recovery flow.
- Duplicate hub-registry overlap avoided; the existing shared Sentinel hub registry remains authoritative.
- Managed staff-role persistence/adoption implemented with ambiguity review instead of duplicate creation.
- Permission projection from persisted staff bindings implemented while preserving owner-identity separation.
- Managed name-color exclusivity implemented without removing unrelated roles.
- Managed role executor implemented with dry-run behavior, ID persistence, and native Nexus Discord audit entries.
- Hub binding/adoption and persistent-message planning implemented.
- Managed hub executor implemented with dry-run behavior, channel/message ID persistence, ambiguity review, and native Nexus Discord audit entries.

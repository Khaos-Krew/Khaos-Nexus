# Unified AI Runtime Validation

Application source under validation: `b27b1cdc6ea84cccc7b7838ff775bc113d8c1f8c`

## Approved architecture

- One supervised **Khaos Nexus AI Runtime** host.
- **Veyra** runs as the dedicated D&D Lorewarden and Co-DM worker.
- **Nexus Sentinel** runs as the system-health and assistance worker.
- Each agent retains a separate child process, private data directory, endpoint, readiness contract, credentials, logs, tools, memory boundary, restart path, and failure boundary.
- Veyra receives no application diagnostics, maintenance authority, or system credentials.
- Nexus Sentinel receives no D&D campaign, character, DM-only, or homebrew context.
- The isolated AI repositories remain the focused bug-reproduction and candidate-fix lanes. The desktop repository remains the authoritative production source.

## Local validation completed

- All changed JavaScript and CommonJS files passed syntax validation.
- The focused unified-runtime and compatibility suites passed.
- The complete exported-source suite passed 481 of 496 tests; the remaining 15 require third-party modules that were unavailable in the source-export environment (`discord.js`, `electron`, and `selfsigned`) rather than reporting application assertion failures.
- A real embedded-host run started Veyra and Nexus Sentinel together, verified both readiness contracts, and stopped both workers cleanly.
- Veyra readiness is launch-scoped and rejects stale port occupancy.
- Hostile inherited Node and AI environment variables are removed before either worker starts.
- Nexus Sentinel readiness and request envelopes match the pinned service contract: API version `1`, target service `nexus-ai-core`.
- Absolute entrypoint and private-file containment checks prevent the host from launching or writing outside the verified bundle and per-agent data roots.
- One worker can fail or restart without terminating the other worker or the desktop runtime host.

## Exact-head refresh

Exact branch-head inspection confirmed that both the unified host implementation and the replacement Nexus Sentinel lifecycle test are present. A prior pull-request run reported the pre-unification lifecycle assertion, so an evidence-only commit regenerated GitHub's synthetic pull-request merge snapshot without weakening any assertion or changing production behavior.

The refreshed suite then found one legitimate branding-contract mismatch: the Co-DM security test requires the renderer to disclose the shared host, while the new copy named only Veyra. The renderer now states that **Veyra runs as the D&D worker inside the Khaos Nexus AI Runtime**, while preserving the credential-isolation and explicit-context-transfer disclosure. The temporary patch workflow removed itself before this owner-authored validation head.

## Release acceptance boundary

Local validation is supporting evidence only. Merge and publication remain blocked until the exact PR head passes repository CI, Windows packaging, bundled-runtime verification, packaged startup, clean installation, installed runtime integrity, hostile owner-environment startup, updater identity, and protected publication checks.

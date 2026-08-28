# Server Integration Architecture Decision — 2026-08-28

## Status
Accepted

## Decision
Khaos Nexus will remove provider-specific Nitrado integration from the hosted-server management architecture. Server connectivity will remain provider-neutral and use supported game/server management interfaces such as REST and RCON.

For Palworld, Nexus should expose Palworld REST as the preferred game-management interface where safely reachable, with RCON retained as a compatibility/fallback option where required. Nitrado service IDs, Nitrado API tokens, Nitrado-specific adapters, provider-specific control paths, and Nitrado-specific setup requirements are no longer part of the target architecture.

Khaos Nexus will also discontinue active Once Human server integration work. Once Human Custom Server IDs are not considered safe durable ownership identifiers because an ID can be reused after a rental changes hands. Nexus must not bind persistent automation, ownership, permissions, or administrative authority to a Once Human server ID under that model.

## Required cleanup
- Remove Nitrado-specific setup choices, adapter code, token/service-ID fields, validation, documentation, tests, and roadmap items where they exist.
- Preserve generic hosted-server registry capabilities that are provider-neutral.
- Preserve generic REST/RCON connection configuration and protected secret handling.
- Keep Palworld REST/RCON support independent of any hosting provider.
- Remove Once Human server-manager commands, configuration-profile work, ownership bindings, integration tests, setup guidance, and active roadmap commitments.
- Do not delete generic configuration/profile primitives that are useful to other games; only detach Once Human-specific schemas and UI.
- Mark historical Once Human research as retired/reference-only if retained for project history.

## Rationale
Provider-neutral REST/RCON support reduces coupling to a single host and avoids duplicated provider-control logic when the game already exposes a supported management interface.

Once Human server IDs cannot safely function as a durable foreign key for a Nexus-managed server because reuse can associate a previously stored identifier with a different renter. That creates unacceptable ownership, privacy, and administrative-control risk.

## Acceptance criteria
1. `/server` setup/configuration has no Nitrado-specific option or credential requirement.
2. Hosted servers can be configured with generic REST, RCON, manual/status-only, or no live connection as applicable.
3. Palworld-specific management uses REST/RCON without depending on hosting-provider identity.
4. No active Once Human integration surface can execute or imply ownership/admin actions from a stored Custom Server ID.
5. Roadmap/audit documentation no longer lists Nitrado-specific integration or Once Human integration as active P0/P1 implementation work.

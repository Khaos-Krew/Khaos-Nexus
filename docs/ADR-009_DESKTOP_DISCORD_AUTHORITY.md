# ADR-009 — Desktop Gateway Remains the Discord Authority

- **Status:** Accepted
- **Date:** 2026-08-05
- **Decision owner:** Khaos Nexus Product Architecture
- **Related issue:** #103

## Context

Khaos Nexus is desktop-first. The Windows application already owns encrypted bot-token custody, slash-command registration, interaction routing, module gates, local permissions, audit records, crash supervision, and game-server control boundaries. A future cloud migration could introduce a second Discord authority, duplicated command registration, conflicting interaction acknowledgements, split audit history, token duplication, and unclear rollback behavior.

## Decision

The supervised Windows desktop gateway remains the single authoritative Discord bot runtime and command router.

Supabase Edge Functions or another cloud service may later provide non-authoritative support such as durable queues, webhook intake, shared read models, or telemetry relays. They must not:

- store or use the primary Discord bot token;
- register global or guild commands;
- acknowledge or route Discord interactions;
- bypass desktop module, permission, confirmation, audit, or maintenance boundaries;
- become a hidden second bot runtime.

Changing this authority model requires a new explicit architecture decision that supersedes ADR-009, includes a token-custody migration, one-authority cutover, idempotent retry and dead-letter design, end-to-end observability, and a tested rollback to the desktop gateway.

## Operational consequences

- **Token custody:** The primary token remains encrypted through Windows secure storage and is supplied only to the supervised desktop utility process.
- **Command registration:** Registration remains serialized through the existing desktop bot startup/configuration flow.
- **Retries and failures:** The desktop supervisor and local audit trail remain authoritative. Supporting cloud queues must use idempotency keys and may not independently replay Discord interactions.
- **Observability:** Desktop runtime state, command registration, interaction failures, and audit records remain the source of truth.
- **Rollback:** Supporting cloud services can be disabled without rotating command ownership or changing the Discord application token.
- **Nexus AI:** `/nexus` commands proxy through the desktop main process; Nexus AI Core never receives Discord authority or the bot token.

## Rejected alternative

A direct migration of Discord authority to a Supabase Edge Function is rejected for the current product line because it conflicts with the desktop-first architecture, introduces duplicate authority risk, and weakens local secure-storage and game-control boundaries without a demonstrated operational benefit.

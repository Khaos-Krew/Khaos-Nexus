# Nexus Cloud Adjunct — Railway `just-warmth`

Status: **Reserved; no service deployed yet**  
Railway project: `just-warmth`  
Environment: `production`

## Purpose

`just-warmth` is reserved for Nexus components that benefit from being continuously available on the public internet but do **not** need direct control of the Windows desktop host or private game-server credentials.

Khaos Nexus remains desktop-first and local-first. Railway is an adjunct, not the control plane.

## Appropriate Railway workloads

- HTTPS webhook ingress for third-party integrations.
- Remote notification/relay workers.
- Optional cross-device synchronization broker.
- Public-safe status or portal APIs.
- Hosted AI/tool workers that consume explicitly scoped, redacted Nexus requests.
- Queue/relay services that can tolerate the desktop being offline.

## Authority that stays local

The Railway project must not become authoritative for:

- raw RCON credentials or unrestricted game-server console access;
- Windows-protected desktop secrets;
- the singleton Nexus scheduler;
- the primary Nexus operational event journal;
- desktop update installation;
- production release authorization;
- owner/access-control recovery;
- unrestricted Discord bot credentials;
- direct database, shell, or infrastructure authority for AI agents.

## Integration rule

When a Railway service is introduced, Nexus Core should communicate through a typed HTTPS/tool contract. Requests must carry correlation IDs and capability context, and returned data must be treated as untrusted external input until validated by Core.

Privileged local execution remains:

`Railway/remote request -> Nexus Core validation -> capability decision -> idempotency acquisition -> deterministic local adapter -> verification -> local journal`

Railway must never bypass the Core command gateway to reach RCON, Discord, scheduler, secret storage, or the local filesystem.

## First eligible checkpoints

- **NX-CP07:** optional context/sync broker, after scope-isolation tests exist.
- **NX-CP08:** hosted AI/tool worker or webhook relay, after typed tool authorization exists.
- **NX-CP10:** optional remote release/status observability, read-only unless explicitly authorized by the Owner.

## Current decision

Do not provision a Railway service during NX-CP00 through the initial NX-CP04 primitives. Those checkpoints are local authority, durability, and authorization work; deploying a cloud service now would increase failure surface without improving their acceptance gates.

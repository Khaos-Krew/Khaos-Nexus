# ARK Restart Safety Policy

Nexus Sentinal must never issue a host-level ARK restart unless one of the following conditions is satisfied:

1. **Zero-player fast path** — the server is confirmed to have `0` connected players immediately before the restart. Sentinal still saves the world before the host restart.
2. **Occupied-server controlled restart** — Sentinal has completed a full 30-minute warning window, including the configured countdown warnings, performs a world save at the beginning of the controlled restart workflow, performs a second world save during the final five seconds, then issues the host restart only after that second save succeeds.

## Fail-closed requirements

- If player count cannot be confirmed, treat the server as occupied.
- If the 30-minute warning window was not started and tracked by Sentinal for the current restart attempt, do not restart an occupied server.
- If either required `SaveWorld` fails, abort the restart.
- If Citadel/GameCP does not accept the restart command, report failure and do not mark the restart complete.
- A restart authorization is single-use and must not be carried across a later restart attempt.

## Update orchestration

This policy applies equally to scheduled maintenance, ASA game updates, ArkAPI/API maintenance, plugin maintenance, and staff-triggered restarts. Update automation may prepare or stage changes ahead of time, but deployment must not cross the host-restart boundary unless this policy is satisfied.

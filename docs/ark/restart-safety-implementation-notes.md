Implementation target for Nexus Sentinal restart safety:

- Every host-level ARK restart must pass through one shared restart coordinator.
- Coordinator checks `ListPlayers` immediately before deciding the restart path.
- `0` players: `SaveWorld` -> Citadel restart.
- `>0` players or unknown player count: require a Sentinal-owned 30-minute warning authorization for the same restart attempt; perform countdown warnings; save at controlled-window start; during the final five seconds perform the second `SaveWorld`; only after success issue Citadel restart.
- No caller may bypass this coordinator for update deployment, scheduled maintenance, or staff controls.

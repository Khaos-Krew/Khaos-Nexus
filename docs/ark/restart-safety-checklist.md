# Restart safety checklist

Before any host-level ARK restart:

- [ ] Query `ListPlayers`.
- [ ] If player count is exactly zero, save world and restart.
- [ ] Otherwise require a Sentinal-owned 30-minute warning window.
- [ ] Save world at the 30-minute warning.
- [ ] Continue countdown warnings.
- [ ] Save world again at five seconds.
- [ ] Wait for the final save to succeed.
- [ ] Re-check player count at the restart boundary.
- [ ] Issue the Citadel/GameCP restart only if the appropriate gate still passes.
- [ ] Monitor offline transition and recovery.

Unknown player count is never treated as zero.

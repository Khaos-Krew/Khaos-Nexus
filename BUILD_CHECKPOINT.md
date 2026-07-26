# Khaos Nexus v0.17.1 Owner-Test Checkpoint

This branch preserves the Windows test build that adds centralized reporting for failed buttons and renderer actions.

- Every failed IPC action records the active page, button/element, IPC channel, error message, safe stack, and occurrence count.
- Protected credentials and payload values are not retained.
- Repeated failures are deduplicated for health reporting while their occurrence count is preserved.
- Application Monitor includes a retained UI Action Errors panel with copy and clear controls.
- v0.17.0 Pterodactyl, Players & Moderation, Scheduler, and verified software-renderer compatibility remain intact.

This branch is permanent and is not intended to merge separately from the active integration branch.

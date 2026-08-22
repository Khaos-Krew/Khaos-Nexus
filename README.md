# Khaos Nexus 0.1.0 Rebuild

This branch is the clean rebuild of Khaos Nexus.

## Product boundaries

- **Nexus Backend** owns game logic, provider integrations, scheduling hooks, permissions, health and shared contracts.
- **Nexus Sentinel** is the primary Discord interface for normal game-module use through persistent module-console embeds plus deeper commands.
- **Khaos Nexus Desktop** is an Admin Control Center only: Discord administration, account/access linking, module/service management, diagnostics and the private Thora bridge.
- **Thora** remains a private/local capability and is bridged from its canonical project rather than duplicated here.
- **Veyra** may remain the dedicated D&D presentation client while D&D logic follows the same backend-first rule.

## Start

1. Copy `config.example.json` to `config.json`.
2. Fill Discord guild/channel IDs.
3. Set `NEXUS_SENTINEL_TOKEN` in the environment.
4. Set `NEXUS_BACKEND_TOKEN` to a strong shared secret when Sentinel and backend are separate processes.
5. Run `npm install`.
6. Run `npm run backend`.
7. Run `npm run sentinel`.
8. Run `npm start` for the Admin Control Center.

The first rebuild milestone intentionally provides clean contracts and Discord wiring before provider-specific ARK/Palworld/etc. transports are selectively ported from the legacy branches.

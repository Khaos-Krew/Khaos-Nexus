'use strict';

const LAYOUTS = {
  ark: {
    category: 'ARK Survival Ascended',
    aliases: ['ARK', 'ARK ASA', 'ASA', 'ARK Ascended', 'ARK Survival Ascended'],
    consoleChannel: 'ark-console',
    text: ['ark-console', 'ark-tame-info', 'ark-server-status', 'ark-schedules', 'ark-mods', 'ark-lfg'],
    lobbyBuilder: '➕ Join to Create ARK Lobby'
  },
  palworld: {
    category: 'Palworld',
    aliases: ['Palworld'],
    consoleChannel: 'palworld-console',
    text: ['palworld-console', 'palworld-server-status', 'palworld-tracker', 'palworld-backups', 'palworld-lfg'],
    lobbyBuilder: '➕ Join to Create Palworld Lobby'
  },
  minecraft: {
    category: 'Minecraft',
    aliases: ['Minecraft', 'Minecraft Java'],
    consoleChannel: 'minecraft-console',
    text: ['minecraft-console', 'minecraft-server-status', 'minecraft-modpack', 'minecraft-backups', 'minecraft-lfg'],
    lobbyBuilder: '➕ Join to Create Minecraft Lobby'
  },
  warframe: {
    category: 'Warframe',
    aliases: ['Warframe'],
    consoleChannel: 'warframe-hub',
    text: ['warframe-hub', 'warframe-world-state', 'warframe-builds', 'warframe-market', 'warframe-lfg'],
    lobbyBuilder: '➕ Join to Create Warframe Squad'
  },
  division2: {
    category: 'The Division 2',
    aliases: ['The Division 2', 'Division 2'],
    consoleChannel: 'division-hub',
    text: ['division-hub', 'division-builds', 'division-gear', 'division-farming', 'division-weekly', 'division-lfg'],
    lobbyBuilder: '➕ Join to Create Division Lobby'
  },
  rust: {
    category: 'Rust',
    aliases: ['Rust'],
    consoleChannel: 'rust-console',
    text: ['rust-console', 'rust-server-status', 'rust-backups', 'rust-lfg'],
    lobbyBuilder: '➕ Join to Create Rust Lobby'
  },
  satisfactory: {
    category: 'Satisfactory',
    aliases: ['Satisfactory'],
    consoleChannel: 'satisfactory-console',
    text: ['satisfactory-console', 'satisfactory-server-status', 'satisfactory-saves', 'factory-planning', 'satisfactory-lfg'],
    lobbyBuilder: '➕ Join to Create Factory Lobby'
  },
  idleon: {
    category: 'Legends of IdleOn',
    aliases: ['Legends of IdleOn', 'IdleOn'],
    consoleChannel: 'idleon-hub',
    text: ['idleon-hub', 'idleon-progression', 'idleon-builds', 'idleon-goals', 'idleon-farming'],
    lobbyBuilder: '➕ Join to Create IdleOn Lobby'
  },
  pokemongo: {
    category: 'Pokémon GO',
    aliases: ['Pokémon GO', 'Pokemon GO', 'PoGo', 'Pokemon Go'],
    consoleChannel: 'pokemon-go-hub',
    text: ['pokemon-go-hub', 'pokemon-go-raids', 'pokemon-go-trades', 'pokemon-go-events', 'pokemon-go-showcase', 'pokemon-go-lfg'],
    lobbyBuilder: '➕ Join to Create Pokémon GO Group'
  },
  dnd: {
    category: 'Nexus D&D',
    aliases: ['Nexus D&D', 'Nexus DnD', 'D&D', 'DnD'],
    consoleChannel: 'veyra-hub',
    text: ['veyra-hub', 'character-builds', 'campaigns', 'nexus-codex', 'campaign-lfg'],
    lobbyBuilder: '➕ Join to Create D&D Table'
  }
};

function layoutFor(moduleId) {
  const layout = LAYOUTS[moduleId];
  if (!layout) throw new Error(`No Discord layout registered for ${moduleId}.`);
  return { ...layout, aliases: [...(layout.aliases || [])], text: [...layout.text] };
}

module.exports = { LAYOUTS, layoutFor };
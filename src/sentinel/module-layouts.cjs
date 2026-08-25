'use strict';

const LAYOUTS = {
  ark: {
    category: 'ARK Survival Ascended',
    categoryDisplay: 'ARK Survival Ascended 🦖',
    aliases: ['ARK', 'ARK ASA', 'ASA', 'ARK Ascended', 'ARK Survival Ascended'],
    consoleChannel: 'ark-console',
    text: ['ark-console', 'ark-tame-info', 'ark-server-status', 'ark-schedules', 'ark-mods', 'ark-lfg'],
    lobbyBuilder: '➕ Join to Create ARK Lobby'
  },
  callofduty: {
    category: 'Call of Duty',
    categoryDisplay: 'Call of Duty 🎯',
    aliases: ['Call of Duty', 'COD', 'CoD', 'Warzone'],
    consoleChannel: 'cod-hub',
    text: ['cod-hub', 'cod-news', 'cod-warzone', 'cod-multiplayer', 'cod-zombies', 'cod-loadouts', 'cod-lfg'],
    lobbyBuilder: '➕ Join to Create Call of Duty Squad'
  },
  deadbydaylight: {
    category: 'Dead by Daylight',
    categoryDisplay: 'Dead by Daylight 🔪',
    aliases: ['Dead by Daylight', 'DBD', 'DbD'],
    consoleChannel: 'dbd-hub',
    text: ['dbd-hub', 'dbd-killers', 'dbd-survivors', 'dbd-builds', 'dbd-stats', 'dbd-lfg'],
    lobbyBuilder: '➕ Join to Create DBD Lobby'
  },
  diablo4: {
    category: 'Diablo IV',
    categoryDisplay: 'Diablo IV 🔥',
    aliases: ['Diablo IV', 'Diablo 4', 'D4'],
    consoleChannel: 'diablo-hub',
    text: ['diablo-hub', 'diablo-news', 'diablo-builds', 'diablo-items', 'diablo-paragon', 'diablo-farming', 'diablo-lfg'],
    lobbyBuilder: '➕ Join to Create Diablo IV Party'
  },
  palworld: {
    category: 'Palworld',
    categoryDisplay: 'Palworld 🐾',
    aliases: ['Palworld'],
    consoleChannel: 'palworld-console',
    text: ['palworld-console', 'palworld-server-status', 'palworld-tracker', 'palworld-backups', 'palworld-lfg'],
    lobbyBuilder: '➕ Join to Create Palworld Lobby'
  },
  minecraft: {
    category: 'Minecraft',
    categoryDisplay: 'Minecraft ⛏️',
    aliases: ['Minecraft', 'Minecraft Java'],
    consoleChannel: 'minecraft-console',
    text: ['minecraft-console', 'minecraft-server-status', 'minecraft-modpack', 'minecraft-backups', 'minecraft-lfg'],
    lobbyBuilder: '➕ Join to Create Minecraft Lobby'
  },
  oncehuman: {
    category: 'Once Human',
    categoryDisplay: 'Once Human ☣️',
    aliases: ['Once Human', 'OnceHuman'],
    consoleChannel: 'once-human-hub',
    text: ['once-human-hub', 'once-human-news', 'once-human-builds', 'once-human-reference', 'once-human-wishlist', 'once-human-lfg'],
    lobbyBuilder: '➕ Join to Create Once Human Team'
  },
  osrs: {
    category: 'OSRS',
    categoryDisplay: 'OSRS ⚔️',
    aliases: ['OSRS', 'Old School RuneScape', 'Oldschool RuneScape'],
    consoleChannel: 'osrs-hub',
    text: ['osrs-hub', 'osrs-hiscores', 'osrs-grand-exchange', 'osrs-guides', 'osrs-lfg'],
    lobbyBuilder: '➕ Join to Create OSRS Group'
  },
  runescape3: {
    category: 'RuneScape 3',
    categoryDisplay: 'RuneScape 3 ✨',
    aliases: ['RuneScape 3', 'RS3'],
    consoleChannel: 'rs3-hub',
    text: ['rs3-hub', 'rs3-hiscores', 'rs3-grand-exchange', 'rs3-guides', 'rs3-lfg'],
    lobbyBuilder: '➕ Join to Create RuneScape 3 Group'
  },
  warframe: {
    category: 'Warframe',
    categoryDisplay: 'Warframe ⚡',
    aliases: ['Warframe'],
    consoleChannel: 'warframe-hub',
    text: ['warframe-hub', 'warframe-world-state', 'warframe-builds', 'warframe-market', 'warframe-lfg'],
    lobbyBuilder: '➕ Join to Create Warframe Squad'
  },
  division2: {
    category: 'The Division 2',
    categoryDisplay: 'The Division 2 🟠',
    aliases: ['The Division 2', 'Division 2'],
    consoleChannel: 'division-hub',
    text: ['division-hub', 'division-builds', 'division-gear', 'division-farming', 'division-weekly', 'division-lfg'],
    lobbyBuilder: '➕ Join to Create Division Lobby'
  },
  rust: {
    category: 'Rust',
    categoryDisplay: 'Rust 🛠️',
    aliases: ['Rust'],
    consoleChannel: 'rust-console',
    text: ['rust-console', 'rust-server-status', 'rust-backups', 'rust-lfg'],
    lobbyBuilder: '➕ Join to Create Rust Lobby'
  },
  satisfactory: {
    category: 'Satisfactory',
    categoryDisplay: 'Satisfactory 🏭',
    aliases: ['Satisfactory'],
    consoleChannel: 'satisfactory-console',
    text: ['satisfactory-console', 'satisfactory-server-status', 'satisfactory-saves', 'factory-planning', 'satisfactory-lfg'],
    lobbyBuilder: '➕ Join to Create Factory Lobby'
  },
  idleon: {
    category: 'Legends of IdleOn',
    categoryDisplay: 'Legends of IdleOn 🧙',
    aliases: ['Legends of IdleOn', 'IdleOn'],
    consoleChannel: 'idleon-hub',
    text: ['idleon-hub', 'idleon-progression', 'idleon-builds', 'idleon-goals', 'idleon-farming'],
    lobbyBuilder: '➕ Join to Create IdleOn Lobby'
  },
  pokemongo: {
    category: 'Pokémon GO',
    categoryDisplay: 'Pokémon GO 🧭',
    aliases: ['Pokémon GO', 'Pokemon GO', 'PoGo', 'Pokemon Go'],
    consoleChannel: 'pokemon-go-hub',
    text: ['pokemon-go-hub', 'pokemon-go-raids', 'pokemon-go-trades', 'pokemon-go-events', 'pokemon-go-showcase', 'pokemon-go-lfg'],
    lobbyBuilder: '➕ Join to Create Pokémon GO Group'
  },
  dnd: {
    category: 'Nexus D&D',
    categoryDisplay: 'Nexus D&D 🎲',
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

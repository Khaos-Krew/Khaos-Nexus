'use strict';

const LAYOUTS = {
  ark: { category: 'ARK Survival Ascended', consoleChannel: 'ark-console', text: ['ark-console', 'ark-info', 'ark-lfg'], lobbyBuilder: '➕ Join to Create ARK Lobby' },
  palworld: { category: 'Palworld', consoleChannel: 'palworld-console', text: ['palworld-console', 'palworld-info', 'palworld-lfg'], lobbyBuilder: '➕ Join to Create Palworld Lobby' },
  minecraft: { category: 'Minecraft', consoleChannel: 'minecraft-console', text: ['minecraft-console', 'minecraft-modpack', 'minecraft-lfg'], lobbyBuilder: '➕ Join to Create Minecraft Lobby' },
  warframe: { category: 'Warframe', consoleChannel: 'warframe-hub', text: ['warframe-hub', 'warframe-builds', 'warframe-lfg', 'warframe-market'], lobbyBuilder: '➕ Join to Create Warframe Squad' },
  division2: { category: 'The Division 2', consoleChannel: 'division-hub', text: ['division-hub', 'division-builds', 'division-lfg', 'division-farming'], lobbyBuilder: '➕ Join to Create Division Lobby' },
  rust: { category: 'Rust', consoleChannel: 'rust-console', text: ['rust-console', 'rust-info', 'rust-lfg'], lobbyBuilder: '➕ Join to Create Rust Lobby' },
  satisfactory: { category: 'Satisfactory', consoleChannel: 'satisfactory-console', text: ['satisfactory-console', 'factory-planning', 'satisfactory-lfg'], lobbyBuilder: '➕ Join to Create Factory Lobby' },
  idleon: { category: 'Legends of IdleOn', consoleChannel: 'idleon-hub', text: ['idleon-hub', 'idleon-builds', 'idleon-goals'], lobbyBuilder: '➕ Join to Create IdleOn Lobby' },
  dnd: { category: 'Nexus D&D', consoleChannel: 'veyra-hub', text: ['veyra-hub', 'character-builds', 'campaign-lfg'], lobbyBuilder: '➕ Join to Create D&D Table' }
};

function layoutFor(moduleId) {
  const layout = LAYOUTS[moduleId];
  if (!layout) throw new Error(`No Discord layout registered for ${moduleId}.`);
  return { ...layout, text: [...layout.text] };
}

module.exports = { LAYOUTS, layoutFor };

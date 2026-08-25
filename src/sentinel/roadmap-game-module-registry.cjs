'use strict';

const { MODULES } = require('../backend/modules/catalog.cjs');
const { LAYOUTS } = require('./module-layouts.cjs');

const ROADMAP_GAME_MODULES = Object.freeze([
  {
    id: '7daystodie',
    name: '7 Days to Die',
    console: true,
    capabilities: [],
    layout: {
      category: '7 Days to Die',
      categoryDisplay: '7 Days to Die 🧟',
      aliases: ['7 Days to Die', '7DTD', '7D2D'],
      consoleChannel: '7dtd-hub',
      text: ['7dtd-hub', '7dtd-builds', '7dtd-crafting', '7dtd-guides', '7dtd-lfg'],
      lobbyBuilder: '➕ Join to Create 7 Days to Die Group'
    }
  },
  {
    id: 'conanexiles',
    name: 'Conan Exiles',
    console: true,
    capabilities: [],
    layout: {
      category: 'Conan Exiles',
      categoryDisplay: 'Conan Exiles ⚔️',
      aliases: ['Conan Exiles', 'Conan'],
      consoleChannel: 'conan-hub',
      text: ['conan-hub', 'conan-builds', 'conan-crafting', 'conan-guides', 'conan-lfg'],
      lobbyBuilder: '➕ Join to Create Conan Exiles Group'
    }
  },
  {
    id: 'destiny2',
    name: 'Destiny 2',
    console: true,
    capabilities: [],
    layout: {
      category: 'Destiny 2',
      categoryDisplay: 'Destiny 2 🌌',
      aliases: ['Destiny 2', 'Destiny', 'D2'],
      consoleChannel: 'destiny-hub',
      text: ['destiny-hub', 'destiny-builds', 'destiny-activities', 'destiny-vendors', 'destiny-lfg'],
      lobbyBuilder: '➕ Join to Create Destiny 2 Fireteam'
    }
  }
]);

function registerRoadmapGameModules() {
  const registered = [];
  for (const definition of ROADMAP_GAME_MODULES) {
    if (!MODULES.some((module) => module.id === definition.id)) {
      MODULES.push({
        id: definition.id,
        name: definition.name,
        console: definition.console,
        capabilities: definition.capabilities.map((capability) => ({ ...capability }))
      });
      registered.push(definition.id);
    }
    if (!LAYOUTS[definition.id]) {
      LAYOUTS[definition.id] = {
        ...definition.layout,
        aliases: [...definition.layout.aliases],
        text: [...definition.layout.text]
      };
    }
  }
  return registered;
}

module.exports = { ROADMAP_GAME_MODULES, registerRoadmapGameModules };

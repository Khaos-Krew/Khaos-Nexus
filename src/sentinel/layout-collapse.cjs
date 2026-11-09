'use strict';

const fs = require('node:fs');
const { LAYOUTS, layoutFor } = require('./module-layouts.cjs');
const { ROADMAP_GAME_MODULES } = require('./roadmap-game-module-registry.cjs');
const { STAFF_HELD_LAYOUT_CHANNELS } = require('./manual-layout.cjs');

// Player-facing rooms for these games are a hub plus an lfg channel. Voice
// lobbies are not part of the collapse; they live in the player Voice category.
// Division, Pokémon GO, and Palworld keep their full layouts.
const SLIM_GAME_MODULE_IDS = Object.freeze([
  'callofduty',
  'deadbydaylight',
  'diablo4',
  'destiny2',
  'warframe'
]);

const FULL_LAYOUT_MODULE_IDS = Object.freeze([
  'division2',
  'pokemongo',
  'palworld'
]);

function isSlimGameModule(moduleId) {
  return SLIM_GAME_MODULE_IDS.includes(String(moduleId || '').trim().toLowerCase());
}

function layoutDefinition(moduleId) {
  const id = String(moduleId || '').trim().toLowerCase();
  if (LAYOUTS[id]) return layoutFor(id);
  const roadmap = ROADMAP_GAME_MODULES.find((item) => item.id === id);
  if (!roadmap) throw new Error(`No Discord layout registered for ${id}.`);
  return {
    ...roadmap.layout,
    aliases: [...roadmap.layout.aliases],
    text: [...roadmap.layout.text]
  };
}

function lfgChannelName(layout) {
  return (layout?.text || []).find((name) => name === 'lfg' || String(name).endsWith('-lfg')) || '';
}

function slimTextNames(layout) {
  return [...new Set([layout?.consoleChannel, lfgChannelName(layout)].filter(Boolean))];
}

function collapseChannelNames(layout) {
  const keep = new Set(slimTextNames(layout));
  return (layout?.text || []).filter((name) => !keep.has(name));
}

function textNamesForLayout(moduleId, layout, { slim = false, preserveManualLayout = false } = {}) {
  if (slim && isSlimGameModule(moduleId)) return slimTextNames(layout);
  if (preserveManualLayout) return (layout.text || []).filter((name) => name === layout.consoleChannel);
  return [...(layout.text || [])];
}

function valuesOf(collection) {
  if (!collection) return [];
  if (Array.isArray(collection)) return collection;
  if (typeof collection.values === 'function') return [...collection.values()];
  return Object.values(collection);
}

function readInventory(inventoryPath) {
  const parsed = JSON.parse(fs.readFileSync(inventoryPath, 'utf8'));
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.channels)) return parsed.channels;
  if (Array.isArray(parsed?.guild?.channels)) return parsed.guild.channels;
  throw new Error('Inventory must be a channel array or an object with a channels array.');
}

function channelNameOf(channel) {
  return String(channel?.name || '').trim().toLowerCase();
}

function matchingChannels(channels, name) {
  const wanted = String(name || '').trim().toLowerCase();
  return valuesOf(channels)
    .filter((channel) => channel && channelNameOf(channel) === wanted)
    .map((channel) => ({
      id: String(channel.id || ''),
      name: String(channel.name || ''),
      type: channel.type,
      parentId: String(channel.parent_id || channel.parentId || '')
    }));
}

// Lists layout channels a slim game would drop. Never deletes or posts.
function collapseDryRun({ channels = null, inventoryPath = '' } = {}) {
  const loaded = channels || (inventoryPath ? readInventory(inventoryPath) : null);
  const modules = SLIM_GAME_MODULE_IDS.map((moduleId) => {
    const layout = layoutDefinition(moduleId);
    return {
      moduleId,
      category: layout.category,
      keep: slimTextNames(layout),
      lobbyBuilder: layout.lobbyBuilder || '',
      remove: collapseChannelNames(layout).map((name) => ({
        name,
        matches: loaded ? matchingChannels(loaded, name) : []
      }))
    };
  });
  return {
    deleted: false,
    posts: false,
    rolesChanged: false,
    slimModules: [...SLIM_GAME_MODULE_IDS],
    keptFullModules: [...FULL_LAYOUT_MODULE_IDS],
    staffHeldChannels: [...STAFF_HELD_LAYOUT_CHANNELS],
    modules
  };
}

function formatCollapseDryRun(result) {
  const lines = [
    'Discord layout collapse dry run',
    'No channels are deleted. No messages are posted. Game roles are not changed.',
    'Review the names below, then delete by hand if you still want them gone.',
    ''
  ];
  for (const module of result.modules || []) {
    lines.push(`${module.moduleId} (${module.category})`);
    lines.push(`  keep: ${module.keep.join(', ') || '(none)'}`);
    lines.push(`  voice lobby stays: ${module.lobbyBuilder || '(none)'}`);
    if (!module.remove.length) {
      lines.push('  would remove: (none)');
    } else {
      lines.push('  would remove:');
      for (const item of module.remove) {
        const found = item.matches || [];
        if (!found.length) lines.push(`    - ${item.name}`);
        else {
          const where = found.map((match) => `${match.id || 'no-id'}${match.parentId ? ` parent ${match.parentId}` : ''}`).join('; ');
          lines.push(`    - ${item.name} (${where})`);
        }
      }
    }
    lines.push('');
  }
  lines.push(`Left unchanged: ${result.keptFullModules.join(', ')}`);
  lines.push(`Staff-held consoles and backups are not removal candidates: ${result.staffHeldChannels.join(', ')}`);
  return `${lines.join('\n')}\n`;
}

module.exports = {
  FULL_LAYOUT_MODULE_IDS,
  SLIM_GAME_MODULE_IDS,
  collapseChannelNames,
  collapseDryRun,
  formatCollapseDryRun,
  isSlimGameModule,
  layoutDefinition,
  lfgChannelName,
  matchingChannels,
  readInventory,
  slimTextNames,
  textNamesForLayout
};

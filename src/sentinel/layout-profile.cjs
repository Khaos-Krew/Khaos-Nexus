'use strict';

const { ChannelType } = require('discord.js');
const { LAYOUTS } = require('./module-layouts.cjs');
const { ROADMAP_GAME_MODULES } = require('./roadmap-game-module-registry.cjs');
const { flagEnabled } = require('./manual-layout.cjs');

// Approved player-facing collapse (Nov 9 layout): hub + lfg only.
// Division, Pokémon GO, and Palworld stay on their full layouts.
const SLIM_GAME_MODULE_IDS = Object.freeze([
  'callofduty',
  'deadbydaylight',
  'diablo4',
  'destiny2',
  'warframe'
]);

// Minecraft first. Warframe stays last so the player Voice category can sit
// immediately above Staff, matching the approved sidebar.
const APPROVED_GAME_CATEGORY_ORDER = Object.freeze([
  'minecraft',
  'ark',
  'palworld',
  'pokemongo',
  'division2',
  'callofduty',
  'deadbydaylight',
  'diablo4',
  'destiny2',
  'warframe'
]);

const REMOVABLE_CHANNEL_TYPES = new Set([
  ChannelType.GuildText,
  ChannelType.GuildAnnouncement,
  ChannelType.GuildForum
]);

function layoutRecord(moduleId) {
  const id = String(moduleId || '').trim().toLowerCase();
  if (LAYOUTS[id]) return LAYOUTS[id];
  const roadmap = ROADMAP_GAME_MODULES.find((item) => item.id === id);
  return roadmap?.layout || null;
}

function slimGameLayoutEnabled(config = {}) {
  const value = config?.discord?.slimGameLayout;
  if (value === undefined || value === null || value === '') return true;
  return flagEnabled(value);
}

function isSlimGameModule(moduleId) {
  return SLIM_GAME_MODULE_IDS.includes(String(moduleId || '').trim().toLowerCase());
}

function hubAndLfg(layout) {
  const text = Array.isArray(layout?.text) ? layout.text : [];
  const hub = String(layout?.consoleChannel || '');
  const lfg = text.find((name) => /-lfg$/i.test(String(name))) || '';
  return [...new Set([hub, lfg].filter(Boolean))];
}

function playerFacingTextChannels(moduleId, config = {}, layout = null) {
  const record = layout || layoutRecord(moduleId);
  if (!record) return [];
  if (isSlimGameModule(moduleId) && slimGameLayoutEnabled(config)) return hubAndLfg(record);
  return [...(record.text || [])];
}

function managedTextChannels(moduleId, config = {}, { respectManual = false, layout = null } = {}) {
  const player = playerFacingTextChannels(moduleId, config, layout);
  if (isSlimGameModule(moduleId) && slimGameLayoutEnabled(config)) return player;
  if (respectManual) {
    const hub = String((layout || layoutRecord(moduleId))?.consoleChannel || '');
    return player.filter((name) => name === hub);
  }
  return player;
}

function collapseRemovalNames(moduleId, config = {}) {
  if (!isSlimGameModule(moduleId) || !slimGameLayoutEnabled(config)) return [];
  const record = layoutRecord(moduleId);
  if (!record) return [];
  const keep = new Set(hubAndLfg(record));
  return (record.text || []).filter((name) => !keep.has(name));
}

function channelList(channels) {
  if (!channels) return [];
  if (Array.isArray(channels)) return channels;
  if (typeof channels.values === 'function') return [...channels.values()];
  return [];
}

function collapseDryRun(channels = [], config = {}) {
  const presentByName = new Map();
  for (const channel of channelList(channels)) {
    const name = String(channel?.name || '');
    if (!name || !REMOVABLE_CHANNEL_TYPES.has(channel?.type)) continue;
    if (!presentByName.has(name)) presentByName.set(name, []);
    presentByName.get(name).push(channel);
  }

  const modules = SLIM_GAME_MODULE_IDS.map((moduleId) => {
    const record = layoutRecord(moduleId);
    const remove = collapseRemovalNames(moduleId, config);
    const present = [];
    for (const name of remove) {
      for (const match of presentByName.get(name) || []) {
        present.push({
          name,
          id: String(match.id || ''),
          parentId: String(match.parentId || match.parent_id || ''),
          type: match.type
        });
      }
    }
    return {
      moduleId,
      category: String(record?.category || ''),
      keep: hubAndLfg(record || {}),
      remove,
      present,
      absent: remove.filter((name) => !(presentByName.get(name) || []).length)
    };
  });

  return {
    dryRun: true,
    deletesPerformed: false,
    rolesChanged: false,
    slim: slimGameLayoutEnabled(config),
    modules
  };
}

function formatCollapseDryRun(report, { onlyPresent = false } = {}) {
  if (!report?.slim) {
    return [
      '**Collapse dry-run** — nothing was deleted.',
      'Slim game layout is off, so no subchannels are candidates.'
    ].join('\n');
  }
  const lines = ['**Collapse dry-run** — nothing was deleted.', ''];
  for (const module of report.modules || []) {
    lines.push(`**${module.category || module.moduleId}**`);
    if (module.present?.length) {
      lines.push(module.present.map((item) => (
        item.id ? `#${item.name} \`${item.id}\`` : `#${item.name}`
      )).join('\n'));
    } else if (!onlyPresent) {
      lines.push(module.remove.length
        ? `Layout names: ${module.remove.map((name) => `#${name}`).join(', ')}`
        : 'No extra subchannels.');
    } else {
      lines.push('No matching channels in this guild.');
    }
    lines.push('');
  }
  lines.push('Kept as-is: Division, Pokémon GO, Palworld, and every game role.');
  lines.push('Voice lobbies are not deletion candidates.');
  return lines.join('\n').trim().slice(0, 1900);
}

function configuredGameCategoryOrder(config = {}) {
  const raw = config?.discord?.gameCategoryOrder;
  const list = Array.isArray(raw) ? raw : String(raw || '').split(',');
  const ids = [...new Set(list.map((item) => String(item || '').trim().toLowerCase()).filter(Boolean))];
  if (ids.length === 1 && (ids[0] === 'approved' || ids[0] === 'default')) return [...APPROVED_GAME_CATEGORY_ORDER];
  return ids;
}

function playerVoiceCategoryId(config = {}) {
  const id = String(config?.discord?.playerVoiceCategoryId || '').trim();
  return /^\d{17,20}$/.test(id) ? id : '';
}

function pinPlayerVoiceEnabled(config = {}) {
  const value = config?.discord?.pinPlayerVoice;
  if (value === undefined || value === null || value === '') return true;
  return flagEnabled(value);
}

function enforceGameCategoryOrder(config = {}) {
  return flagEnabled(config?.discord?.enforceGameCategoryOrder);
}

module.exports = {
  APPROVED_GAME_CATEGORY_ORDER,
  SLIM_GAME_MODULE_IDS,
  collapseDryRun,
  collapseRemovalNames,
  configuredGameCategoryOrder,
  enforceGameCategoryOrder,
  formatCollapseDryRun,
  hubAndLfg,
  isSlimGameModule,
  layoutRecord,
  managedTextChannels,
  pinPlayerVoiceEnabled,
  playerFacingTextChannels,
  playerVoiceCategoryId,
  slimGameLayoutEnabled
};

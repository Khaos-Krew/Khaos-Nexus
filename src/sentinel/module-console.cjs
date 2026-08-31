'use strict';

const { getModule } = require('../backend/modules/catalog.cjs');
const { usageForModule } = require('./friendly-commands.cjs');

const CUSTOM_ID_PREFIX = 'nexusmod';
const ARK_PLAYER_ACTION_PREFIX = 'nexusark';
const ARK_PLAYER_ACTIONS = Object.freeze([
  { id: 'link', label: 'Link ARK Account', emoji: '🔗', style: 3 },
  { id: 'link-status', label: 'My Link & Rank', emoji: '🪪', style: 1 },
  { id: 'cache-guide', label: 'Dino Cache Shop', emoji: '🦖', style: 2 },
  { id: 'daily-status', label: 'Daily Reward Status', emoji: '🎁', style: 2 },
  { id: 'weekly-status', label: 'Weekly Reward Status', emoji: '🎁', style: 2 }
]);
const POGO_COMMANDS = Object.freeze([
  '/pogo panel', '/pogo profile show', '/pogo profile set', '/pogo friends',
  '/pogo raid list', '/pogo raid create', '/pogo raid rsvp', '/pogo raid cancel',
  '/pogo trade list', '/pogo trade add', '/pogo trade matches', '/pogo trade remove',
  '/pogo vivillon', '/pogo collection list', '/pogo collection add', '/pogo collection remove',
  '/pogo showcase list', '/pogo showcase add', '/pogo meetup list', '/pogo meetup create', '/pogo meetup rsvp',
  '/pogo event list', '/pogo event add', '/pogo event remove', '/pogo counter', '/pogo pvp'
]);

function actionId(moduleId, actionId) { return `${CUSTOM_ID_PREFIX}:${moduleId}:${actionId}`; }
function arkPlayerActionId(actionId) { return `${ARK_PLAYER_ACTION_PREFIX}:${actionId}`; }

function parseActionId(value) {
  const match = /^nexusmod:([a-z0-9-]+):([a-z0-9-]+)$/.exec(String(value || ''));
  return match ? { moduleId: match[1], actionId: match[2] } : null;
}

function parseArkPlayerActionId(value) {
  const match = /^nexusark:([a-z0-9-]+)$/.exec(String(value || ''));
  if (!match || !ARK_PLAYER_ACTIONS.some((action) => action.id === match[1])) return null;
  if (match[1] === 'daily-status') return { actionId: match[1], subcommand: 'supporter-cache-status', type: 'daily' };
  if (match[1] === 'weekly-status') return { actionId: match[1], subcommand: 'supporter-cache-status', type: 'weekly' };
  if (match[1] === 'cache-guide') return { actionId: match[1], subcommand: 'shop-cache-guide' };
  return { actionId: match[1], subcommand: match[1] };
}

function arkPlayerActionRow() {
  return { type: 1, components: ARK_PLAYER_ACTIONS.map((action) => ({
    type: 2,
    style: action.style,
    label: action.label,
    emoji: { name: action.emoji },
    custom_id: arkPlayerActionId(action.id)
  })) };
}

function style(cap) {
  if (cap.destructive) return 4;
  if (cap.requiredRole === 'operator') return 2;
  return 1;
}

function buttonCapabilities(module) { return module.capabilities.filter((cap) => cap.button !== false).slice(0, 20); }
function friendlyUsage(moduleId) { return moduleId === 'pokemongo' ? [...POGO_COMMANDS] : usageForModule(moduleId); }

function renderModuleConsole(moduleId, backendState = {}) {
  const module = getModule(moduleId);
  if (!module) throw new Error(`Unknown module: ${moduleId}`);
  const connected = backendState.connected === true;
  const enabled = backendState.enabled !== false;
  const configured = backendState.configured === true;
  const availableActions = new Set(Array.isArray(backendState.availableActions) ? backendState.availableActions : []);
  const providerActions = Array.isArray(backendState.providerAvailableActions) ? backendState.providerAvailableActions : [];
  const serviceActions = Array.isArray(backendState.serviceAvailableActions) ? backendState.serviceAvailableActions : [];
  const providerKind = String(backendState.providerKind || 'none');
  const availableCount = availableActions.size;
  const state = !enabled
    ? 'DISABLED'
    : connected
      ? 'READY • CONNECTED'
      : configured && providerActions.length
        ? 'READY • BACKEND ACTIVE'
        : !configured && serviceActions.length
          ? 'BACKEND READY • PROVIDER SETUP NEEDED'
          : configured
            ? 'BACKEND ACTIVE • FEATURES UNAVAILABLE'
            : 'BACKEND READY • PROVIDER SETUP NEEDED';

  const buttons = buttonCapabilities(module).map((cap) => ({
    type: 2,
    style: style(cap),
    label: cap.label.slice(0, 80),
    custom_id: actionId(module.id, cap.id),
    disabled: !enabled || !availableActions.has(cap.id)
  }));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) rows.push({ type: 1, components: buttons.slice(i, i + 5) });
  if (module.id === 'ark') rows.push(arkPlayerActionRow());
  rows.push({ type: 1, components: [
    { type: 2, style: 2, label: 'Commands / Help', custom_id: actionId(module.id, 'help') },
    { type: 2, style: 2, label: 'Refresh', custom_id: actionId(module.id, 'refresh') }
  ]});

  const fields = [
    { name: 'Interface', value: module.surface === 'veyra' ? 'Veyra' : 'Nexus Sentinal', inline: true },
    { name: 'Backend', value: `${availableCount}/${module.capabilities.length} actions`, inline: true }
  ];
  if (providerKind !== 'none') fields.push({ name: 'Provider', value: providerKind.slice(0, 100), inline: true });
  if (serviceActions.length) fields.push({
    name: 'Shared Services',
    value: serviceActions.map((id) => `\`${id}\``).join(', ').slice(0, 1000),
    inline: false
  });
  if (module.id === 'ark') fields.push({
    name: 'Player Shortcuts',
    value: 'Link your ARK identity, check your synced Nexus rank, review Dino Cache prices, or check supporter reward availability without typing a slash command.',
    inline: false
  });

  const friendly = friendlyUsage(moduleId);
  const commandHint = friendly.length
    ? `Try **${friendly[0]}** or press **Commands / Help** for the full feature catalog.`
    : module.surface === 'veyra'
      ? 'Use Veyra for normal D&D interaction.'
      : 'Use the buttons below for normal interaction.';

  return {
    embeds: [{
      title: `KHAOS NEXUS • ${module.name.toUpperCase()}`,
      description: `**${state}**\nUse the buttons below or the short module commands. ${commandHint}`,
      fields,
      footer: { text: 'Nexus 0.1 • Simple commands • Backend-first module console' }
    }],
    components: rows,
    allowed_mentions: { parse: [] }
  };
}

function chunkLines(lines, maxLength = 1000) {
  const chunks = [];
  let current = '';
  for (const rawLine of lines) {
    const line = String(rawLine || '').slice(0, maxLength);
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxLength && current) {
      chunks.push(current);
      current = line;
    } else current = next;
  }
  if (current) chunks.push(current);
  return chunks;
}

function fieldsFromLines(name, lines, maxChunks = 6) {
  return chunkLines(lines).slice(0, maxChunks).map((value, index) => ({
    name: index === 0 ? name : `${name} • continued`,
    value,
    inline: false
  }));
}

function capabilityLine(capability) {
  const prefix = capability.destructive ? '⚠️ ' : '• ';
  if (capability.id === 'taming') return `${prefix}**${capability.label}** — interactive creature dropdown, level/rates, KO ammo, weapon damage, and top-five food calculator`;
  const suffix = capability.input ? ` — ${String(capability.input).slice(0, 120)}` : '';
  return `${prefix}**${capability.label}**${suffix}`;
}

function capabilityFields(module) {
  const groups = [
    ['Player features', module.capabilities.filter((cap) => cap.requiredRole === 'viewer')],
    ['Operator / admin features', module.capabilities.filter((cap) => cap.requiredRole === 'operator')],
    ['Owner controls', module.capabilities.filter((cap) => cap.requiredRole === 'owner')]
  ];
  return groups.flatMap(([name, capabilities]) => capabilities.length
    ? fieldsFromLines(name, capabilities.map(capabilityLine), 3)
    : []);
}

function renderHelp(moduleId) {
  const module = getModule(moduleId);
  if (!module) throw new Error(`Unknown module: ${moduleId}`);
  const commands = friendlyUsage(moduleId);
  const fields = capabilityFields(module);
  if (commands.length) fields.push(...fieldsFromLines('Easy commands', commands.map((command) => `• \`${command}\``), 6));

  const surfaceNote = module.surface === 'veyra'
    ? 'Use **Veyra** for normal D&D interaction. The feature list below comes from the shared Nexus backend contract.'
    : 'Features are sourced from the Nexus backend capability contract, so the Discord catalog stays aligned as module capabilities grow.';
  const safetyNote = module.capabilities.some((cap) => cap.destructive)
    ? '\n\n⚠️ Destructive controls remain permission-gated and require confirmation where the backend contract requires it.'
    : '';

  return {
    embeds: [{
      title: `${module.name} • Features & Commands`,
      description: `${surfaceNote}${safetyNote}`.slice(0, 4000),
      fields: fields.slice(0, 25),
      footer: {
        text: commands.length
          ? 'Use the short commands or module-panel controls; advanced /nexus run is compatibility/troubleshooting only.'
          : 'Nexus backend capabilities remain the source of truth for this module.'
      }
    }],
    allowed_mentions: { parse: [] }
  };
}

module.exports = {
  ARK_PLAYER_ACTIONS,
  actionId,
  arkPlayerActionId,
  parseActionId,
  parseArkPlayerActionId,
  arkPlayerActionRow,
  renderModuleConsole,
  renderHelp,
  buttonCapabilities,
  friendlyUsage,
  chunkLines,
  capabilityFields
};

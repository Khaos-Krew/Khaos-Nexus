'use strict';

const { getModule } = require('../backend/modules/catalog.cjs');
const { usageForModule } = require('./friendly-commands.cjs');

const CUSTOM_ID_PREFIX = 'nexusmod';
const POGO_COMMANDS = Object.freeze([
  '/pogo panel', '/pogo profile show', '/pogo profile set', '/pogo friends',
  '/pogo raid list', '/pogo raid create', '/pogo raid rsvp', '/pogo raid cancel',
  '/pogo trade list', '/pogo trade add', '/pogo trade matches', '/pogo trade remove',
  '/pogo vivillon', '/pogo collection list', '/pogo collection add', '/pogo collection remove',
  '/pogo showcase list', '/pogo showcase add', '/pogo meetup list', '/pogo meetup create', '/pogo meetup rsvp',
  '/pogo event list', '/pogo event add', '/pogo event remove', '/pogo counter', '/pogo pvp'
]);

function actionId(moduleId, actionId) { return `${CUSTOM_ID_PREFIX}:${moduleId}:${actionId}`; }

function parseActionId(value) {
  const match = /^nexusmod:([a-z0-9-]+):([a-z0-9-]+)$/.exec(String(value || ''));
  return match ? { moduleId: match[1], actionId: match[2] } : null;
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

  const friendly = friendlyUsage(moduleId);
  const commandHint = friendly.length
    ? `Try **${friendly[0]}** or press **Commands / Help** for the full easy command list.`
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

function renderHelp(moduleId) {
  const module = getModule(moduleId);
  if (!module) throw new Error(`Unknown module: ${moduleId}`);
  const commands = friendlyUsage(moduleId);
  if (!commands.length) {
    return {
      embeds: [{
        title: `${module.name} • Commands`,
        description: module.surface === 'veyra'
          ? 'This module is designed to be used through **Veyra** rather than raw Nexus Sentinal capability commands.'
          : 'Use the module panel buttons for normal actions.'
      }]
    };
  }
  const lines = commands.map((command) => `• \`${command}\``);
  return {
    embeds: [{
      title: `${module.name} • Easy Commands`,
      description: `${lines.join('\n')}\n\nYou do **not** need backend action IDs for normal use.`.slice(0, 4000),
      footer: { text: 'Advanced /nexus run remains available only for compatibility and troubleshooting.' }
    }]
  };
}

module.exports = { actionId, parseActionId, renderModuleConsole, renderHelp, buttonCapabilities, friendlyUsage };

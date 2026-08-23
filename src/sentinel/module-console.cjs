'use strict';

const { getModule } = require('../backend/modules/catalog.cjs');

const CUSTOM_ID_PREFIX = 'nexusmod';

function actionId(moduleId, actionId) {
  return `${CUSTOM_ID_PREFIX}:${moduleId}:${actionId}`;
}

function parseActionId(value) {
  const match = /^nexusmod:([a-z0-9-]+):([a-z0-9-]+)$/.exec(String(value || ''));
  return match ? { moduleId: match[1], actionId: match[2] } : null;
}

function style(cap) {
  if (cap.destructive) return 4;
  if (cap.requiredRole === 'operator') return 2;
  return 1;
}

function renderModuleConsole(moduleId, backendState = {}) {
  const module = getModule(moduleId);
  if (!module) throw new Error(`Unknown module: ${moduleId}`);
  const connected = backendState.configured === true;
  const enabled = backendState.enabled !== false;
  const state = !enabled ? 'DISABLED' : connected ? 'READY • CONNECTED' : 'READY';
  const buttons = module.capabilities.slice(0, 20).map((cap) => ({
    type: 2,
    style: style(cap),
    label: cap.label.slice(0, 80),
    custom_id: actionId(module.id, cap.id),
    disabled: !enabled
  }));
  const rows = [];
  for (let i = 0; i < buttons.length; i += 5) rows.push({ type: 1, components: buttons.slice(i, i + 5) });
  rows.push({ type: 1, components: [
    { type: 2, style: 2, label: 'Features / Commands', custom_id: actionId(module.id, 'help') },
    { type: 2, style: 2, label: 'Refresh', custom_id: actionId(module.id, 'refresh') }
  ]});
  const fields = [
    { name: 'Interface', value: module.surface === 'veyra' ? 'Veyra' : 'Nexus Sentinal', inline: true }
  ];
  if (connected) fields.push({ name: 'Connection', value: 'Connected', inline: true });
  return {
    embeds: [{
      title: `KHAOS NEXUS • ${module.name.toUpperCase()}`,
      description: `**${state}**\nUse the controls below for common actions. Advanced/parameterized actions remain available through Sentinal commands as they are added.`,
      fields,
      footer: { text: 'Nexus 0.1 • Backend-first module console' }
    }],
    components: rows,
    allowed_mentions: { parse: [] }
  };
}

function renderHelp(moduleId) {
  const module = getModule(moduleId);
  const lines = module.capabilities.map((cap) => `• **${cap.label}** — ${cap.requiredRole}${cap.destructive ? ' • confirmation required' : ''}`);
  return { embeds: [{ title: `${module.name} • Features`, description: lines.join('\n') || 'No capabilities registered.' }], ephemeral: true };
}

module.exports = { actionId, parseActionId, renderModuleConsole, renderHelp };

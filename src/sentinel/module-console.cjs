'use strict';

const { getModule } = require('../backend/modules/catalog.cjs');

const CUSTOM_ID_PREFIX = 'nexusmod';

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
    { type: 2, style: 2, label: 'Features / Commands', custom_id: actionId(module.id, 'help') },
    { type: 2, style: 2, label: 'Refresh', custom_id: actionId(module.id, 'refresh') }
  ]});

  const fields = [
    { name: 'Interface', value: module.surface === 'veyra' ? 'Veyra' : 'Nexus Sentinal', inline: true },
    { name: 'Backend', value: `${availableCount}/${module.capabilities.length} actions`, inline: true }
  ];
  if (providerKind !== 'none') fields.push({ name: 'Provider', value: providerKind.slice(0, 100), inline: true });
  if (serviceActions.length) fields.push({ name: 'Shared Services', value: serviceActions.map((id) => `\`${id}\``).join(', ').slice(0, 1000), inline: false });

  return {
    embeds: [{
      title: `KHAOS NEXUS • ${module.name.toUpperCase()}`,
      description: `**${state}**\nUse buttons for quick actions. Parameterized and advanced actions are available through \`/nexus run\`; use **Features / Commands** for the exact action names.`,
      fields,
      footer: { text: 'Nexus 0.1 • Backend-first module console' }
    }],
    components: rows,
    allowed_mentions: { parse: [] }
  };
}

function renderHelp(moduleId) {
  const module = getModule(moduleId);
  if (!module) throw new Error(`Unknown module: ${moduleId}`);
  const lines = module.capabilities.map((cap) => {
    const input = cap.input ? ` • input: \`${cap.input}\`` : '';
    const confirm = cap.destructive ? ' • confirmation required' : '';
    return `• \`${cap.id}\` — **${cap.label}** • ${cap.requiredRole}${confirm}${input}`;
  });
  return {
    embeds: [{
      title: `${module.name} • Backend Features`,
      description: `${lines.join('\n') || 'No capabilities registered.'}\n\nAdvanced usage: \`/nexus run module:${module.id} action:<action> input:<value>\``.slice(0, 4000)
    }]
  };
}

module.exports = { actionId, parseActionId, renderModuleConsole, renderHelp, buttonCapabilities };

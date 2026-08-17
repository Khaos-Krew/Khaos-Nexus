'use strict';

const electron = require('electron');
const runtimes = require('./bundled-ai-runtimes-extension.cjs');
const { assertOwner } = require('./dnd-access-policy-extension.cjs');

let installed = false;

function standaloneStatus() {
  const full = runtimes.status();
  const dnd = (full.services || full.agents || []).find((service) => service?.key === 'dnd') || {
    key: 'dnd',
    name: 'Veyra',
    status: 'stopped'
  };
  return {
    ...full,
    runtimeLabel: 'Veyra Local Runtime',
    agents: [dnd],
    services: [dnd],
    standalone: true,
    allowedAgents: ['dnd']
  };
}

function requestedService(input = {}) {
  const value = String(input.service || input.id || 'dnd').trim().toLowerCase();
  if (!value || value === 'dnd' || value === 'all') return 'dnd';
  const error = new Error('Nexus D&D can start only the Veyra D&D AI runtime.');
  error.code = 'DND_STANDALONE_AI_SCOPE';
  throw error;
}

async function perform(action, input = {}) {
  assertOwner(`${action[0].toUpperCase()}${action.slice(1)} Veyra`);
  requestedService(input);
  if (action === 'start') return runtimes.start('dnd');
  if (action === 'restart') return runtimes.restart('dnd');
  if (action === 'stop') return runtimes.stop('dnd');
  throw new Error(`Unsupported Veyra runtime action: ${action}`);
}

function replaceHandlers() {
  for (const channel of [
    'ai:runtimes-status',
    'ai:runtimes-start',
    'ai:runtimes-stop',
    'ai:runtimes-restart'
  ]) {
    try { electron.ipcMain.removeHandler(channel); } catch {}
  }

  electron.ipcMain.handle('ai:runtimes-status', () => {
    assertOwner('View Veyra runtime status');
    return standaloneStatus();
  });
  electron.ipcMain.handle('ai:runtimes-start', (_event, input = {}) => perform('start', input));
  electron.ipcMain.handle('ai:runtimes-stop', (_event, input = {}) => perform('stop', input));
  electron.ipcMain.handle('ai:runtimes-restart', (_event, input = {}) => perform('restart', input));
}

function install() {
  if (installed) return;
  installed = true;
  // bundled-ai-runtimes registers its compatibility handlers first. This
  // replacement is intentionally registered afterwards and narrows them.
  electron.app.whenReady().then(replaceHandlers);
}

module.exports = {
  install,
  standaloneStatus,
  requestedService,
  perform
};

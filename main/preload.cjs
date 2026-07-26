'use strict';

const { contextBridge, ipcRenderer } = require('electron');
const { isExpectedAccessDenial } = require('../shared/renderer-action-errors.cjs');

const REPORT_EXCLUDED_CHANNELS = new Set([
  'stability:heartbeat',
  'monitor:capture-renderer',
  'renderer-errors:get',
  'renderer-errors:clear',
  'renderer-errors:copy-latest',
  'startup-health:get',
  'startup-health:renderer-ready'
]);
let lastInteraction = null;

function sendRendererHeartbeat() {
  ipcRenderer.invoke('stability:heartbeat').catch(() => {});
}

sendRendererHeartbeat();
const rendererHeartbeatTimer = setInterval(sendRendererHeartbeat, 2000);
process.once('exit', () => clearInterval(rendererHeartbeatTimer));

function subscribe(channel, callback) {
  const listener = (_event, state) => callback(state);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

function cleanText(value, max = 160) {
  return String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function elementContext(element) {
  const target = element?.closest?.('button, [role="button"], a, input, select, textarea') || element;
  if (!target || typeof target !== 'object') return {};
  return {
    elementId: cleanText(target.id, 120),
    elementText: cleanText(target.getAttribute?.('aria-label') || target.title || target.textContent || target.value, 160),
    elementTag: cleanText(target.tagName, 40).toLowerCase(),
    operation: cleanText(
      target.dataset?.hostedSignal || target.dataset?.view || target.dataset?.viewLink || target.dataset?.commandView ||
      target.getAttribute?.('name') || target.id || target.textContent,
      140
    )
  };
}

function currentView() {
  try { return cleanText(document.querySelector?.('.view.active')?.id || 'unknown-view', 100).replace(/^view-/, ''); }
  catch { return 'unknown-view'; }
}

function reportRendererActionError(input = {}) {
  if (isExpectedAccessDenial(input.error || input.message || input.reason || input)) return { ignored: true, reason: 'expected-access-denial' };
  const error = input.error instanceof Error ? input.error : null;
  let interaction = input.interaction || lastInteraction || {};
  try { if (!Object.keys(interaction).length) interaction = elementContext(document.activeElement); } catch {}
  ipcRenderer.send('renderer-action:error', {
    source: input.source || 'manual',
    channel: cleanText(input.channel || '', 140),
    view: cleanText(input.view || currentView(), 100),
    operation: cleanText(input.operation || interaction?.operation || '', 140),
    elementId: cleanText(input.elementId || interaction?.elementId || '', 120),
    elementText: cleanText(input.elementText || interaction?.elementText || '', 160),
    elementTag: cleanText(input.elementTag || interaction?.elementTag || '', 40),
    message: cleanText(input.message || error?.message || String(input.reason || 'Unknown renderer error'), 1600),
    stack: String(input.stack || error?.stack || '').slice(0, 12000),
    time: new Date().toISOString()
  });
  return { reported: true };
}

async function invoke(channel, payload) {
  try {
    return await ipcRenderer.invoke(channel, payload);
  } catch (error) {
    if (!REPORT_EXCLUDED_CHANNELS.has(channel) && !isExpectedAccessDenial(error)) {
      reportRendererActionError({ source: 'ipc', channel, error, interaction: lastInteraction });
    }
    throw error;
  }
}

try {
  window.addEventListener('click', (event) => {
    lastInteraction = elementContext(event.target);
  }, true);
} catch {}

contextBridge.exposeInMainWorld('khaos', {
  invoke,
  reportRendererActionError: (payload) => reportRendererActionError(payload || {}),
  isExpectedAccessDenial: (value) => isExpectedAccessDenial(value),
  reportBootStage: (stage, detail = {}) => ipcRenderer.send('renderer-boot:stage', {
    stage: String(stage || 'unknown').slice(0, 80),
    detail: detail && typeof detail === 'object' ? detail : {},
    time: new Date().toISOString()
  }),
  onState: (callback) => subscribe('state:update', callback),
  onStartupHealth: (callback) => subscribe('startup-health:update', callback),
  onLog: (callback) => subscribe('log:entry', callback),
  onUpdate: (callback) => subscribe('update:state', callback),
  onDiscordAutomation: (callback) => subscribe('discord-automation:update', callback),
  onDiscordObservability: (callback) => subscribe('discord-observability:state', callback),
  onStatusPanels: (callback) => subscribe('status-panels:update', callback),
  onServerScheduler: (callback) => subscribe('server-scheduler:update', callback),
  onPlayerConsole: (callback) => subscribe('player-console:update', callback),
  onHostedServer: (callback) => subscribe('hosted-server:update', callback),
  onRendererErrors: (callback) => subscribe('renderer-errors:update', callback)
});

ipcRenderer.invoke('startup-health:renderer-ready').catch((error) => {
  reportRendererActionError({ source: 'startup-health', channel: 'startup-health:renderer-ready', error });
});

'use strict';

const { randomUUID } = require('node:crypto');
const electron = require('electron');
const runtimes = require('./bundled-ai-runtimes-extension.cjs');

const allowedCapabilities = new Set([
  'nexus.help',
  'nexus.discord.assist',
  'nexus.update.poll',
  'nexus.update.state',
  'nexus.maintenance.propose'
]);
let installed = false;

function safeText(value, max = 4000) {
  return String(value ?? '').replace(/@everyone|@here/gi, '@ disabled').slice(0, max);
}

async function request(pathname, { method = 'GET', capability = null, body = null } = {}) {
  const { endpoint, serviceToken } = runtimes.coreConnection();
  if (capability && !allowedCapabilities.has(capability)) throw new Error('Unsupported Nexus AI Core capability.');
  const requestId = method === 'POST' ? randomUUID() : null;
  const payload = method === 'POST' ? {
    ...(body && typeof body === 'object' && !Array.isArray(body) ? body : {}),
    apiVersion: 'v1',
    requestId,
    targetService: 'khaos-nexus',
    routingDepth: 0,
    capability
  } : undefined;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  let response;
  try {
    response = await fetch(new URL(pathname, endpoint), {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${serviceToken}`,
        ...(payload ? { 'Content-Type': 'application/json', 'X-Khaos-Request-Id': requestId } : {})
      },
      body: payload ? JSON.stringify(payload) : undefined,
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal
    });
  } finally {
    clearTimeout(timer);
  }
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) throw new Error('Nexus AI Core returned an invalid content type.');
  const data = await response.json();
  if (!response.ok) throw new Error(safeText(data?.error?.message || 'Nexus AI Core request failed.', 500));
  if (requestId && data.requestId !== requestId) throw new Error('Nexus AI Core response identity did not match.');
  return data;
}

async function negotiate() {
  const [health, capabilities, contracts] = await Promise.all([
    request('/health'),
    request('/api/v1/capabilities'),
    request('/api/v1/contracts')
  ]);
  if (health.apiVersion !== 'v1' || capabilities.apiVersion !== 'v1') throw new Error('Nexus AI Core API version is incompatible.');
  if (health.targetService !== 'khaos-nexus' || capabilities.targetService !== 'khaos-nexus') throw new Error('Nexus AI Core target is incompatible.');
  if (capabilities.directExecution !== false || capabilities.directDiscordConnection !== false || capabilities.directServiceForwarding !== false) throw new Error('Nexus AI Core authority contract is unsafe.');
  if ((capabilities.capabilities || []).some((item) => String(item).startsWith('dnd.'))) throw new Error('Nexus AI Core advertised a D&D capability.');
  return {
    ready: true,
    service: health.service,
    version: health.version,
    providerStatus: health.providerStatus,
    monitorAvailable: capabilities.capabilities?.includes('nexus.update.poll') === true,
    contracts: {
      service: contracts.contractVersion || contracts.serviceContractVersion || '1.0.0',
      api: health.apiVersion
    }
  };
}

async function status() {
  const runtime = runtimes.status().services.find((item) => item.key === 'core');
  if (!runtime || runtime.status !== 'ready') return { runtime, ready: false };
  try { return { runtime, ...(await negotiate()) }; }
  catch (error) { return { runtime, ready: false, error: safeText(error.message, 500) }; }
}

async function checkNow(input = {}) {
  const sources = Array.isArray(input.sources) ? input.sources.slice(0, 50) : [];
  return request('/api/v1/monitor/poll', {
    method: 'POST',
    capability: 'nexus.update.poll',
    body: { sources, reason: 'owner-manual-check' }
  });
}

async function ask(input = {}) {
  const prompt = safeText(input.prompt, 4000).trim();
  if (!prompt) throw new Error('A Nexus AI prompt is required.');
  return request('/api/v1/discord/assist', {
    method: 'POST',
    capability: 'nexus.discord.assist',
    body: { prompt, context: input.context && typeof input.context === 'object' ? input.context : {}, visibility: 'ephemeral' }
  });
}

async function proposeMaintenance(input = {}) {
  return request('/api/v1/maintenance/plans', {
    method: 'POST',
    capability: 'nexus.maintenance.propose',
    body: { findings: Array.isArray(input.findings) ? input.findings.slice(0, 100) : [], executionAllowed: false }
  });
}

function install() {
  if (installed) return;
  installed = true;
  electron.app.whenReady().then(() => {
    electron.ipcMain.handle('nexus-ai-core:status', () => status());
    electron.ipcMain.handle('nexus-ai-core:check-now', (_event, input) => checkNow(input));
    electron.ipcMain.handle('nexus-ai-core:ask', (_event, input) => ask(input));
    electron.ipcMain.handle('nexus-ai-core:propose-maintenance', (_event, input) => proposeMaintenance(input));
  });
}

module.exports = { install, status, negotiate, checkNow, ask, proposeMaintenance, safeText };

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const electron = require('electron');
const { safeStorage } = electron;
const {
  DND_AI_REPOSITORY,
  AI_CORE_REPOSITORY,
  AI_CORE_SNAPSHOT,
  DEFAULT_AI_CORE_ENDPOINT,
  AI_CORE_HEALTH_PATH,
  AI_CORE_CAPABILITIES_PATH,
  clone,
  cleanText,
  normalizeServiceEndpoint,
  normalizeServiceToken,
  normalizeAiCoreSettings,
  normalizeAiCoreHealth,
  normalizeAiCoreCapabilities,
  unavailableAiCore,
  aiCoreBootstrap,
  publicAiCoreBootstrap
} = require('../shared/ai-service-connections.cjs');

const REQUEST_TIMEOUT_MS = 15000;
const HEALTH_CACHE_MS = 30000;
const MAX_RESPONSE_CHARACTERS = 512000;
const MAX_AUDIT_ENTRIES = 100;
const refs = { configStore: null, autonomy: null, discordAuth: null, supervisor: null, logger: null };
let installed = false;
let registered = false;
let registerTimer = null;
let coreCache = null;

function nowIso() { return new Date().toISOString(); }
function actorId() { return String(refs.discordAuth?.getState?.().user?.id || 'local-owner'); }
function currentRole() {
  try { return refs.autonomy?.accessState?.(refs.discordAuth?.getState?.())?.role || 'locked'; }
  catch { return 'locked'; }
}
function assertOwner(action) {
  if (refs.autonomy?.assertAccess) return refs.autonomy.assertAccess(refs.discordAuth?.getState?.(), 'owner', action);
  if (!['owner', 'local-admin'].includes(currentRole())) {
    throw Object.assign(new Error(`${action} requires Khaos Nexus Owner access.`), { code: 'OWNER_ACCESS_REQUIRED' });
  }
  return true;
}

function safeError(error, token = '') {
  const secret = String(token || '');
  const replace = (value) => cleanText(String(value || '').split(secret).join('[REDACTED]'), 1000);
  return {
    code: cleanText(error?.code || 'AI_SERVICE_REQUEST_FAILED', 100),
    status: Number(error?.status || 0) || null,
    message: replace(error?.message || error || 'AI service request failed.')
  };
}

function ensureAiServicesConfig(store) {
  store.config.aiServices ||= {};
  store.config.aiServices.core = normalizeAiCoreSettings(store.config.aiServices.core || {}, store.config.aiServices.core || {});
  store.config.aiServices.audit = Array.isArray(store.config.aiServices.audit) ? store.config.aiServices.audit.slice(-MAX_AUDIT_ENTRIES) : [];
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosAiServices) return;

  class AiServicesConfigStore extends Original {
    constructor(...args) {
      super(...args);
      ensureAiServicesConfig(this);
      this.saveConfig();
      refs.configStore = this;
      scheduleRegister();
    }

    getAiCoreServiceToken() {
      return String(this.secrets.aiCoreServiceToken || '');
    }

    setAiCoreServiceToken(value) {
      const token = normalizeServiceToken(value);
      if (token) this.secrets.aiCoreServiceToken = token;
      else delete this.secrets.aiCoreServiceToken;
      this.saveSecrets();
      coreCache = null;
      return { hasServiceToken: Boolean(token) };
    }

    getAiCoreSettings() {
      ensureAiServicesConfig(this);
      return {
        ...clone(this.config.aiServices.core),
        hasServiceToken: Boolean(this.getAiCoreServiceToken())
      };
    }

    setAiCoreSettings(input = {}) {
      ensureAiServicesConfig(this);
      this.config.aiServices.core = normalizeAiCoreSettings({ ...input, updatedAt: nowIso() }, this.config.aiServices.core);
      this.saveConfig();
      coreCache = null;
      return this.getAiCoreSettings();
    }

    appendAiServiceAudit(action, metadata = {}) {
      ensureAiServicesConfig(this);
      const entry = {
        id: require('node:crypto').randomUUID(),
        time: nowIso(),
        actorId: cleanText(actorId(), 100),
        action: cleanText(action, 120),
        metadata: Object.fromEntries(Object.entries(metadata || {}).slice(0, 20).map(([key, value]) => [cleanText(key, 80), cleanText(value, 500)]))
      };
      this.config.aiServices.audit.push(entry);
      this.config.aiServices.audit = this.config.aiServices.audit.slice(-MAX_AUDIT_ENTRIES);
      this.saveConfig();
      return clone(entry);
    }

    getAiServiceAudit() {
      ensureAiServicesConfig(this);
      return clone(this.config.aiServices.audit.slice(-25).reverse());
    }

    getSecretValues() {
      return [...super.getSecretValues(), this.secrets.aiCoreServiceToken].filter(Boolean);
    }

    getPublicConfig() {
      const config = super.getPublicConfig();
      config.aiServices ||= {};
      config.aiServices.core = {
        ...clone(this.config.aiServices.core),
        hasServiceToken: Boolean(this.getAiCoreServiceToken())
      };
      return config;
    }

    getRuntimeBootstrap() {
      const bootstrap = super.getRuntimeBootstrap();
      const connection = aiCoreBootstrap(this.config.aiServices?.core || {}, this.getAiCoreServiceToken());
      if (connection) bootstrap.aiCore = connection;
      else delete bootstrap.aiCore;
      return bootstrap;
    }

    getRegisteredBotBootstraps(...args) {
      const values = typeof super.getRegisteredBotBootstraps === 'function' ? super.getRegisteredBotBootstraps(...args) : [];
      return values.map((bootstrap) => {
        const value = clone(bootstrap);
        delete value.aiCore;
        return value;
      });
    }

    createBackupPayload(appVersion) {
      const payload = super.createBackupPayload(appVersion);
      if (!this.secrets?.aiCoreServiceToken) return payload;
      if (!safeStorage.isEncryptionAvailable()) {
        payload.encryptedSecrets = null;
        payload.note = `${payload.note} The Nexus AI Core service token was excluded because protected storage was unavailable.`;
        return payload;
      }
      const sanitized = { ...this.secrets };
      delete sanitized.aiCoreServiceToken;
      payload.encryptedSecrets = safeStorage.encryptString(JSON.stringify(sanitized)).toString('base64');
      payload.note = `${payload.note} The Nexus AI Core service token is intentionally excluded from backups.`;
      return payload;
    }
  }

  Object.defineProperty(AiServicesConfigStore, '__khaosAiServices', { value: true });
  target.ConfigStore = AiServicesConfigStore;
}

function patchBotSupervisor() {
  const target = require('./services/bot-supervisor.cjs');
  const Original = target.BotSupervisor;
  if (!Original || Original.__khaosAiServices) return;

  class AiServicesBotSupervisor extends Original {
    constructor(...args) {
      super(...args);
      refs.supervisor = this;
      this.state.aiCore = { enabled: false, reachable: false, checkedAt: null, error: 'Not linked to the primary bot.' };
      scheduleRegister();
    }

    botPath() {
      return electron.app.isPackaged
        ? path.join(process.resourcesPath, 'app.asar', 'bot', 'dual-ai-index.cjs')
        : path.join(__dirname, '..', 'bot', 'dual-ai-index.cjs');
    }

    handleMessage(message) {
      if (message?.type === 'ai-core-status') {
        const value = message.payload && typeof message.payload === 'object' ? clone(message.payload) : {};
        this.update({ aiCore: value });
        const detail = value.reachable
          ? `Nexus AI Core linked to the primary bot at ${value.endpoint}.`
          : value.enabled ? `Nexus AI Core is linked but unavailable: ${value.error || 'connection failed'}` : 'Nexus AI Core is not linked to the primary bot.';
        this.logger.write(value.reachable ? 'info' : value.enabled ? 'warn' : 'info', detail, {
          enabled: Boolean(value.enabled), reachable: Boolean(value.reachable), version: value.version || '', capabilities: Number(value.capabilities?.length || 0)
        }, 'ai-core');
        return;
      }
      return super.handleMessage(message);
    }
  }

  Object.defineProperty(AiServicesBotSupervisor, '__khaosAiServices', { value: true });
  target.BotSupervisor = AiServicesBotSupervisor;
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosAiServicesCapture) return;
  class Captured extends Original {
    constructor(...args) {
      super(...args);
      refs[refName] = this;
      scheduleRegister();
    }
  }
  Object.defineProperty(Captured, '__khaosAiServicesCapture', { value: true });
  target[exportName] = Captured;
}

async function jsonRequest(endpoint, pathname, token = '', fetchImpl = global.fetch) {
  if (typeof fetchImpl !== 'function') throw Object.assign(new Error('Network requests are unavailable in this build.'), { code: 'AI_SERVICE_NETWORK_UNAVAILABLE' });
  const normalizedEndpoint = normalizeServiceEndpoint(endpoint);
  const headers = { accept: 'application/json', 'user-agent': 'Khaos-Nexus-Desktop-AI-Services/1' };
  if (token) headers.authorization = `Bearer ${token}`;
  let response;
  try {
    response = await fetchImpl(`${normalizedEndpoint}${pathname}`, { method: 'GET', headers, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (error) {
    throw Object.assign(new Error(cleanText(error?.message || 'AI service connection failed.', 800)), { code: error?.name === 'TimeoutError' ? 'AI_SERVICE_TIMEOUT' : 'AI_SERVICE_NETWORK_ERROR' });
  }
  const declaredLength = Number(response.headers?.get?.('content-length') || 0);
  if (declaredLength > MAX_RESPONSE_CHARACTERS) throw Object.assign(new Error('AI service returned an oversized response.'), { code: 'AI_SERVICE_RESPONSE_TOO_LARGE', status: response.status });
  const text = await response.text();
  if (text.length > MAX_RESPONSE_CHARACTERS) throw Object.assign(new Error('AI service returned an oversized response.'), { code: 'AI_SERVICE_RESPONSE_TOO_LARGE', status: response.status });
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; }
  catch { throw Object.assign(new Error('AI service returned invalid JSON.'), { code: 'AI_SERVICE_INVALID_JSON', status: response.status }); }
  if (!response.ok) {
    const message = typeof payload?.error === 'string' ? payload.error : payload?.error?.message || `AI service returned HTTP ${response.status}.`;
    throw Object.assign(new Error(cleanText(message, 800)), { code: cleanText(payload?.error?.code || 'AI_SERVICE_HTTP_ERROR', 100), status: response.status });
  }
  return payload;
}

function cachedCore(settings) {
  if (coreCache?.endpoint === settings.endpoint) return clone(coreCache);
  return unavailableAiCore(settings.endpoint, 'Connection has not been checked yet.');
}

async function checkCore({ force = false, fetchImpl = global.fetch } = {}) {
  const settings = refs.configStore.getAiCoreSettings();
  if (!force && coreCache?.endpoint === settings.endpoint) {
    const age = Date.now() - Date.parse(coreCache.checkedAt || 0);
    if (age >= 0 && age < HEALTH_CACHE_MS) return clone(coreCache);
  }
  const token = refs.configStore.getAiCoreServiceToken();
  try {
    const health = normalizeAiCoreHealth(await jsonRequest(settings.endpoint, AI_CORE_HEALTH_PATH, token, fetchImpl), settings.endpoint);
    const capabilities = normalizeAiCoreCapabilities(await jsonRequest(settings.endpoint, AI_CORE_CAPABILITIES_PATH, token, fetchImpl), settings.endpoint);
    coreCache = { ...health, ...capabilities, endpoint: settings.endpoint, checkedAt: nowIso(), error: '' };
  } catch (error) {
    const safe = safeError(error, token);
    coreCache = unavailableAiCore(settings.endpoint, safe.message);
    coreCache.code = safe.code;
    coreCache.status = safe.status;
  }
  return clone(coreCache);
}

function dndConnection() {
  try {
    const value = require('./dnd-co-dm-extension.cjs').publicPayload('');
    return {
      repository: DND_AI_REPOSITORY,
      role: 'D&D campaign intelligence, Co-DM, homebrew, maps, and explicit AI GM sessions',
      consumers: ['desktop-dnd'],
      settings: {
        endpoint: value.settings?.serviceEndpoint || 'http://127.0.0.1:8787',
        hasServiceToken: Boolean(value.settings?.hasServiceToken)
      },
      service: clone(value.service || {}),
      policy: clone(value.policy || {})
    };
  } catch (error) {
    return {
      repository: DND_AI_REPOSITORY,
      role: 'D&D campaign intelligence, Co-DM, homebrew, maps, and explicit AI GM sessions',
      consumers: ['desktop-dnd'],
      settings: { endpoint: 'http://127.0.0.1:8787', hasServiceToken: false },
      service: { reachable: false, error: cleanText(error?.message || 'D&D AI connection is unavailable.', 800) },
      policy: { desktopOnly: true, nexusBotAccess: false }
    };
  }
}

function publicPayload() {
  const settings = refs.configStore.getAiCoreSettings();
  const service = cachedCore(settings);
  return {
    role: currentRole(),
    dnd: dndConnection(),
    core: {
      repository: AI_CORE_REPOSITORY,
      snapshot: AI_CORE_SNAPSHOT,
      role: 'General app and Nexus Bot intelligence, update monitoring, diagnostics, Discord-safe drafts, and advisory maintenance proposals',
      consumers: settings.linkToPrimaryBot ? ['desktop', 'primary-nexus-bot'] : ['desktop'],
      settings,
      service,
      botBootstrap: publicAiCoreBootstrap(aiCoreBootstrap(settings, refs.configStore.getAiCoreServiceToken()))
    },
    audit: refs.configStore.getAiServiceAudit(),
    policy: {
      independentEndpoints: true,
      independentTokens: true,
      dndAiDesktopOnly: true,
      aiCoreRejectsDndNamespace: true,
      aiCoreAdvisoryOnly: true,
      providerCredentialsServerOwned: true,
      registeredBotsReceiveAiCore: false,
      automaticDiscordPublication: false,
      automaticExecution: false
    }
  };
}

function audit(action, metadata = {}) {
  const entry = refs.configStore.appendAiServiceAudit(action, metadata);
  refs.logger?.write?.('info', `AI services: ${action}`, metadata, 'ai-services');
  return entry;
}

function registerHandlers() {
  if (registered || !refs.configStore || !refs.autonomy || !refs.discordAuth) return false;
  registered = true;
  const ipc = electron.ipcMain;
  ipc.handle('ai:connections-get', () => { assertOwner('View AI service connections'); return publicPayload(); });
  ipc.handle('ai:connections-check', async (_event, input = {}) => {
    assertOwner('Check AI service connections');
    const service = ['dnd', 'core', 'all'].includes(input.service) ? input.service : 'all';
    if (service === 'dnd' || service === 'all') await require('./dnd-co-dm-extension.cjs').checkService({ force: true });
    if (service === 'core' || service === 'all') await checkCore({ force: true });
    audit('connections.checked', { service });
    return publicPayload();
  });
  ipc.handle('ai:core-set-settings', (_event, input = {}) => {
    assertOwner('Change Nexus AI Core connection settings');
    const settings = refs.configStore.setAiCoreSettings(input);
    audit('core.settings-saved', { endpoint: settings.endpoint, enabled: settings.enabled, linkToPrimaryBot: settings.linkToPrimaryBot });
    const botState = refs.supervisor?.getState?.() || {};
    return { settings, restartRequired: Boolean(botState.pid), state: publicPayload() };
  });
  ipc.handle('ai:core-set-token', (_event, input = {}) => {
    assertOwner('Change the Nexus AI Core service token');
    const result = refs.configStore.setAiCoreServiceToken(input.serviceToken);
    audit(input.serviceToken ? 'core.token-saved' : 'core.token-removed', { configured: result.hasServiceToken });
    const botState = refs.supervisor?.getState?.() || {};
    return { ...result, restartRequired: Boolean(botState.pid), state: publicPayload() };
  });
  return true;
}

function scheduleRegister() {
  clearTimeout(registerTimer);
  registerTimer = setTimeout(() => { if (!registerHandlers()) scheduleRegister(); }, 100);
  registerTimer.unref?.();
}

function installRendererAssets() {
  const cssPath = path.join(__dirname, '..', 'renderer', 'ai-services.css');
  const jsPath = path.join(__dirname, '..', 'renderer', 'ai-services.js');
  electron.app.on('browser-window-created', (_event, window) => {
    window.webContents.on('did-finish-load', async () => {
      try {
        await window.webContents.insertCSS(fs.readFileSync(cssPath, 'utf8'));
        await window.webContents.executeJavaScript(fs.readFileSync(jsPath, 'utf8'), true);
      } catch (error) {
        refs.logger?.write?.('error', 'AI Services assets failed to load.', { message: safeError(error).message }, 'ai-services');
      }
    });
  });
}

function install() {
  if (installed) return;
  installed = true;
  patchConfigStore();
  patchBotSupervisor();
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  installRendererAssets();
  scheduleRegister();
}

module.exports = {
  install,
  REQUEST_TIMEOUT_MS,
  HEALTH_CACHE_MS,
  jsonRequest,
  checkCore,
  publicPayload,
  safeError
};

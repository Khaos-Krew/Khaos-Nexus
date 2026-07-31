'use strict';

const path = require('node:path');
const fs = require('node:fs');
const electron = require('electron');
const { utilityProcess, app } = electron;
const {
  normalizeDndState,
  normalizeCampaign,
  normalizeMember,
  normalizeRegisteredApp,
  normalizeBinding,
  normalizeGrant,
  normalizeChannelContext,
  normalizePanel,
  normalizeSession,
  normalizeAttendance,
  normalizeCharacter,
  assertBindingConstraints,
  startSession,
  endSession,
  clean,
  id,
  nowIso
} = require('../shared/dnd-discord.cjs');
const { DndCampaignService } = require('./services/dnd-campaign-service.cjs');

const refs = { configStore: null, logger: null, supervisor: null, autonomy: null, discordAuth: null, service: null };
let installed = false;
let registerTimer = null;

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function patchModuleRegistry() {
  try {
    const registry = require('../shared/module-registry.cjs');
    if (registry.__khaosDndPatched) return;
    const original = registry.moduleDecisionForChannel;
    registry.moduleDecisionForChannel = function dndAwareDecision(channel, args, configStore) {
      if (String(channel || '').startsWith('dnd:')) return { allOf: ['dnd-workspace'] };
      return original(channel, args, configStore);
    };
    Object.defineProperty(registry, '__khaosDndPatched', { value: true });
  } catch {}
}

function installRendererAssets() {
  const cssPath = path.join(__dirname, '..', 'renderer', 'dnd-workspace.css');
  const jsPath = path.join(__dirname, '..', 'renderer', 'dnd-workspace.js');
  electron.app.on('browser-window-created', (_event, window) => {
    window.webContents.on('did-finish-load', async () => {
      try {
        const css = fs.readFileSync(cssPath, 'utf8');
        const script = fs.readFileSync(jsPath, 'utf8');
        await window.webContents.insertCSS(css);
        await window.webContents.executeJavaScript(script, true);
      } catch (error) {
        refs.logger?.error?.('D&D workspace assets failed to load.', { message: error.message });
      }
    });
  });
}

function promoteCatalog() {
  try {
    const { MODULE_CATALOG } = require('../shared/module-catalog.cjs');
    const module = MODULE_CATALOG.find((item) => item.id === 'dnd-workspace');
    if (module) Object.assign(module, {
      stage: 'live',
      launchView: 'dnd',
      requiredRole: 'owner',
      dependencies: ['discord-runtime'],
      hidden: true,
      description: 'Campaigns, registered-bot Discord bindings, character and dice routing, sessions, encounters, quests, sources, homebrew, and game-master tools.',
      features: ['Campaign workspaces', 'Registered-bot grants', 'Existing channel, thread, and forum binding', 'Persistent campaign panels', 'Character and dice commands', 'Sessions and deterministic initiative']
    });
  } catch {}
}

function ensureService() {
  if (!refs.service && refs.configStore && refs.logger) refs.service = new DndCampaignService({ configStore: refs.configStore, logger: refs.logger });
  return refs.service;
}

function ensureConfig(store) {
  store.config.dnd = normalizeDndState(store.config.dnd || {});
  const dnd = store.config.dnd;
  const legacy = dnd.registeredApps.find((item) => item.legacyNexusBot || item.id === 'nexus-bot');
  const normalizedLegacy = normalizeRegisteredApp({
    ...(legacy || {}),
    id: 'nexus-bot',
    applicationId: store.config.discord?.oauthClientId || legacy?.applicationId || '',
    botUserId: legacy?.botUserId || '',
    name: legacy?.name || 'Nexus Bot',
    enabled: legacy?.enabled !== false,
    modules: [...new Set([...(legacy?.modules || []), 'dnd-workspace'])],
    guildIds: [...new Set([...(legacy?.guildIds || []), store.config.discord?.guildId].filter(Boolean))],
    legacyNexusBot: true,
    createdAt: legacy?.createdAt
  });
  if (legacy) dnd.registeredApps[dnd.registeredApps.indexOf(legacy)] = normalizedLegacy;
  else dnd.registeredApps.unshift(normalizedLegacy);
  store.config.dnd = normalizeDndState(dnd);
  store.saveConfig();
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosDndPatched) return;
  class DndConfigStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      ensureConfig(this);
      ensureService();
      scheduleRegister();
    }

    getDndState() { ensureConfig(this); return clone(this.config.dnd); }

    mutateDnd(mutator) {
      ensureConfig(this);
      const result = mutator(this.config.dnd);
      this.config.dnd = normalizeDndState(this.config.dnd);
      this.saveConfig();
      return result;
    }

    upsertDndItem(collection, item, normalizer = (value) => value) {
      return this.mutateDnd((state) => {
        const value = normalizer(item);
        const list = state[collection];
        const index = list.findIndex((entry) => entry.id === value.id);
        if (index >= 0) list[index] = value;
        else list.push(value);
        return clone(value);
      });
    }

    removeDndItem(collection, itemId, { soft = false } = {}) {
      return this.mutateDnd((state) => {
        const index = state[collection].findIndex((entry) => entry.id === itemId);
        if (index < 0) return false;
        if (soft) state[collection][index] = { ...state[collection][index], active: false, updatedAt: nowIso() };
        else state[collection].splice(index, 1);
        return true;
      });
    }

    upsertDndCampaign(input) { return this.upsertDndItem('campaigns', input, normalizeCampaign); }
    upsertDndMember(input) { return this.upsertDndItem('members', input, normalizeMember); }
    upsertDndCharacter(input) { return this.upsertDndItem('characters', input, normalizeCharacter); }
    upsertDndSession(input) { return this.upsertDndItem('sessions', input, normalizeSession); }
    upsertDndAttendance(input) { return this.upsertDndItem('attendance', input, normalizeAttendance); }
    upsertDndPanel(input) { return this.upsertDndItem('panels', input, normalizePanel); }

    upsertDndBinding(input) {
      return this.mutateDnd((state) => {
        const binding = normalizeBinding(input);
        assertBindingConstraints(state.bindings, binding);
        const index = state.bindings.findIndex((entry) => entry.id === binding.id);
        if (index >= 0) state.bindings[index] = binding;
        else state.bindings.push(binding);
        return clone(binding);
      });
    }

    upsertDndGrant(input) {
      return this.mutateDnd((state) => {
        const grant = normalizeGrant(input);
        const existing = state.grants.findIndex((entry) => entry.id === grant.id || (entry.campaignId === grant.campaignId && entry.appId === grant.appId && entry.guildId === grant.guildId));
        if (existing >= 0) state.grants[existing] = { ...grant, id: state.grants[existing].id };
        else state.grants.push(grant);
        return clone(existing >= 0 ? state.grants[existing] : grant);
      });
    }

    upsertDndContext(input) {
      return this.mutateDnd((state) => {
        const context = normalizeChannelContext(input);
        const existing = state.channelContexts.findIndex((entry) => entry.appId === context.appId && entry.guildId === context.guildId && entry.channelId === context.channelId);
        if (existing >= 0) state.channelContexts[existing] = { ...context, id: state.channelContexts[existing].id };
        else state.channelContexts.push(context);
        return clone(existing >= 0 ? state.channelContexts[existing] : context);
      });
    }

    appendDndAudit(input) {
      return this.mutateDnd((state) => {
        const entry = {
          id: clean(input.id, 100) || id('audit'),
          time: input.time || nowIso(),
          actorId: clean(input.actorId, 100),
          action: clean(input.action, 120), outcome: clean(input.outcome || 'success', 30),
          campaignId: clean(input.campaignId, 100), targetId: clean(input.targetId, 100),
          appId: clean(input.appId, 100), guildId: clean(input.guildId, 30),
          metadata: input.metadata && typeof input.metadata === 'object' ? clone(input.metadata) : {}
        };
        state.audit.push(entry);
        if (state.audit.length > 2000) state.audit.splice(0, state.audit.length - 2000);
        if (typeof this.appendDiscordAudit === 'function') {
          try { this.appendDiscordAudit({ category: 'dnd', ...entry, summary: `${entry.action}: ${entry.outcome}` }); } catch {}
        }
        return clone(entry);
      });
    }

    upsertDiscordApp(input) {
      return this.mutateDnd((state) => {
        const appRecord = normalizeRegisteredApp(input);
        if (appRecord.id === 'nexus-bot') appRecord.legacyNexusBot = true;
        const index = state.registeredApps.findIndex((entry) => entry.id === appRecord.id);
        if (index >= 0) state.registeredApps[index] = appRecord;
        else state.registeredApps.push(appRecord);
        return clone(appRecord);
      });
    }

    setDiscordAppToken(appId, token) {
      const record = this.getDndState().registeredApps.find((item) => item.id === appId);
      if (!record) throw new Error('Registered Discord app not found.');
      if (record.legacyNexusBot) return this.setDiscordToken(token);
      this.secrets.discordAppTokens ||= {};
      const value = String(token || '').trim();
      if (value) this.secrets.discordAppTokens[appId] = value;
      else delete this.secrets.discordAppTokens[appId];
      this.saveSecrets();
      return { appId, hasToken: Boolean(value) };
    }

    getDiscordAppToken(appId) {
      const record = this.getDndState().registeredApps.find((item) => item.id === appId);
      if (!record) return '';
      return record.legacyNexusBot ? (this.secrets.discordToken || '') : (this.secrets.discordAppTokens?.[appId] || '');
    }

    getRegisteredAppsPublic() {
      return this.getDndState().registeredApps.map((record) => ({ ...record, hasToken: Boolean(this.getDiscordAppToken(record.id)) }));
    }

    getPublicConfig() {
      const config = super.getPublicConfig();
      config.dnd = this.getDndState();
      config.dnd.registeredApps = this.getRegisteredAppsPublic();
      return config;
    }

    getSecretValues() {
      return [...super.getSecretValues(), ...Object.values(this.secrets.discordAppTokens || {})].filter(Boolean);
    }

    getRuntimeBootstrap() {
      const result = super.getRuntimeBootstrap();
      result.config.dnd = this.getDndState();
      result.config.discordApp = { id: 'nexus-bot', legacyNexusBot: true, name: 'Nexus Bot' };
      return result;
    }

    getRegisteredBotBootstraps() {
      const base = super.getRuntimeBootstrap();
      return this.getDndState().registeredApps
        .filter((record) => record.enabled !== false && !record.legacyNexusBot && record.modules.includes('dnd-workspace'))
        .map((record) => ({
          appId: record.id,
          discordToken: this.getDiscordAppToken(record.id),
          config: {
            ...clone(base.config),
            discord: { ...clone(base.config.discord), guildId: '' },
            discordApp: clone(record),
            dnd: this.getDndState(),
            servers: []
          }
        }))
        .filter((item) => item.discordToken);
    }

    applyDndMutation(input = {}) {
      const operation = String(input.operation || '');
      const data = input.data || {};
      if (operation === 'roll.create') return this.upsertDndItem('rolls', { id: data.id || id('roll'), createdAt: data.createdAt || nowIso(), ...data });
      if (operation === 'context.set') return this.upsertDndContext(data);
      if (operation === 'panel.upsert') return this.upsertDndPanel(data);
      if (operation === 'attendance.set') return this.upsertDndAttendance(data);
      if (operation === 'character.select') return this.mutateDnd((state) => {
        for (const character of state.characters.filter((item) => item.campaignId === data.campaignId && item.discordUserId === data.discordUserId)) character.selected = character.id === data.characterId;
        return true;
      });
      if (operation === 'initiative.join') return this.upsertDndItem('combatants', { id: data.id || id('combatant'), active: true, createdAt: nowIso(), ...data });
      if (operation === 'initiative.next') return this.mutateDnd((state) => {
        const encounter = state.encounters.find((item) => item.id === data.encounterId);
        if (!encounter) throw new Error('Encounter not found.');
        encounter.currentTurnIndex = Number(data.currentTurnIndex || 0);
        encounter.round = Number(data.round || 1);
        encounter.updatedAt = nowIso();
        return clone(encounter);
      });
      if (operation === 'session.start') return this.mutateDnd((state) => clone(startSession(state, data.sessionId, { resetInitiative: Boolean(data.resetInitiative) })));
      if (operation === 'session.end') return this.mutateDnd((state) => clone(endSession(state, data.sessionId)));
      throw Object.assign(new Error(`Unsupported D&D mutation: ${operation}`), { code: 'UNSUPPORTED_DND_MUTATION' });
    }
  }
  Object.defineProperty(DndConfigStore, '__khaosDndPatched', { value: true });
  target.ConfigStore = DndConfigStore;
}

function childPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'app.asar', 'bot', 'entry.cjs')
    : path.join(__dirname, '..', 'bot', 'entry.cjs');
}

function patchSupervisor() {
  const target = require('./services/bot-supervisor.cjs');
  const Original = target.BotSupervisor;
  if (!Original || Original.__khaosDndPatched) return;
  class DndBotSupervisor extends Original {
    constructor(...args) {
      super(...args);
      refs.supervisor = this;
      this.dndChildren = new Map();
      this.dndStates = new Map();
      scheduleRegister();
    }

    botPath() { return childPath(); }

    getState() {
      const state = super.getState();
      state.registeredApps = Object.fromEntries(this.dndStates.entries());
      return state;
    }

    handleMessage(message) {
      if (message?.type === 'dnd-state-change') {
        try {
          const result = this.configStore.applyDndMutation(message.payload);
          this.configStore.appendDndAudit({ action: message.payload.operation, outcome: 'success', campaignId: message.payload.data?.campaignId, appId: message.payload.appId, guildId: message.payload.guildId, actorId: message.payload.actorId });
          this.pushDndConfig();
          return result;
        } catch (error) {
          this.logger.error('D&D bot mutation failed.', { operation: message.payload?.operation, message: error.message });
          return null;
        }
      }
      return super.handleMessage(message);
    }

    spawnRegisteredApp(bootstrap) {
      if (this.dndChildren.has(bootstrap.appId)) return;
      const child = utilityProcess.fork(childPath(), [], { serviceName: `Khaos Nexus Discord App ${bootstrap.appId}`, stdio: 'pipe' });
      this.dndChildren.set(bootstrap.appId, child);
      this.dndStates.set(bootstrap.appId, { status: 'starting', pid: child.pid || null, ready: null, lastError: null });
      child.stdout?.on('data', (chunk) => this.logger.write('info', chunk.toString().trim(), { appId: bootstrap.appId }, 'dnd-bot-stdout'));
      child.stderr?.on('data', (chunk) => this.logger.write('error', chunk.toString().trim(), { appId: bootstrap.appId }, 'dnd-bot-stderr'));
      child.on('message', (event) => {
        const message = event?.data ?? event;
        if (message?.type === 'ready' || message?.type === 'heartbeat') {
          this.dndStates.set(bootstrap.appId, { ...this.dndStates.get(bootstrap.appId), status: message.payload?.ready === false ? 'connecting' : 'online', ready: message.payload, pid: child.pid || null });
          this.refreshAggregateState();
          this.emit('state', this.getState());
          return;
        }
        if (message?.type === 'dnd-state-change') {
          message.payload.appId ||= bootstrap.appId;
          this.handleMessage(message);
          return;
        }
        if (message?.type === 'log') {
          this.logger.ingest({ ...message.payload, source: `bot:${bootstrap.appId}` });
          return;
        }
        if (message?.type === 'error' || message?.type === 'fatal') {
          this.dndStates.set(bootstrap.appId, { ...this.dndStates.get(bootstrap.appId), status: 'error', lastError: message.payload });
          this.logger.error('Registered D&D bot error.', { appId: bootstrap.appId, message: message.payload?.message });
          this.refreshAggregateState();
          this.emit('state', this.getState());
        }
      });
      child.on('exit', (code) => {
        this.dndChildren.delete(bootstrap.appId);
        this.dndStates.set(bootstrap.appId, { ...this.dndStates.get(bootstrap.appId), status: code === 0 ? 'stopped' : 'crashed', pid: null });
        this.refreshAggregateState();
        this.emit('state', this.getState());
      });
      child.postMessage({ type: 'bootstrap', payload: bootstrap });
    }

    startRegisteredApps() {
      for (const bootstrap of this.configStore.getRegisteredBotBootstraps()) this.spawnRegisteredApp(bootstrap);
    }

    pushDndConfig() {
      if (this.child) this.child.postMessage({ type: 'config-update', payload: this.configStore.getRuntimeBootstrap() });
      const bootstraps = new Map(this.configStore.getRegisteredBotBootstraps().map((item) => [item.appId, item]));
      for (const [appId, child] of this.dndChildren) {
        const bootstrap = bootstraps.get(appId);
        if (bootstrap) child.postMessage({ type: 'config-update', payload: bootstrap });
        else { child.postMessage({ type: 'shutdown' }); this.dndChildren.delete(appId); }
      }
      for (const bootstrap of bootstraps.values()) if (!this.dndChildren.has(bootstrap.appId)) this.spawnRegisteredApp(bootstrap);
    }

    refreshAggregateState() {
      if (this.child || !this.dndStates.size) return;
      const states = [...this.dndStates.values()];
      const status = states.some((item) => item.status === 'online') ? 'online'
        : states.some((item) => ['starting', 'connecting'].includes(item.status)) ? 'starting'
          : states.every((item) => item.status === 'stopped') ? 'stopped' : 'error';
      this.update({
        status,
        ready: status === 'online' ? { username: 'Registered Discord apps', guildCount: 0, registeredCommands: 0, readyAt: nowIso() } : null,
        lastError: status === 'error' ? states.find((item) => item.lastError)?.lastError || null : null
      });
    }

    start() {
      const registered = this.configStore.getRegisteredBotBootstraps();
      const primary = this.configStore.getRuntimeBootstrap();
      if (!primary.discordToken && !registered.length) return super.start();
      const result = primary.discordToken ? super.start() : (this.update({ status: 'starting', lastError: null, autoRestartBlocked: false }), this.getState());
      for (const bootstrap of registered) this.spawnRegisteredApp(bootstrap);
      this.refreshAggregateState();
      return result;
    }

    async stop() {
      for (const child of this.dndChildren.values()) {
        try { child.postMessage({ type: 'shutdown' }); } catch {}
        setTimeout(() => { try { child.kill(); } catch {} }, 5000).unref();
      }
      this.dndChildren.clear();
      return super.stop();
    }
  }
  Object.defineProperty(DndBotSupervisor, '__khaosDndPatched', { value: true });
  target.BotSupervisor = DndBotSupervisor;
}

function captureClass(modulePath, exportName, refName) {
  const target = require(modulePath);
  const Original = target[exportName];
  if (!Original || Original.__khaosDndCapturePatched) return;
  class Captured extends Original {
    constructor(...args) { super(...args); refs[refName] = this; ensureService(); scheduleRegister(); }
  }
  Object.defineProperty(Captured, '__khaosDndCapturePatched', { value: true });
  target[exportName] = Captured;
}

function activeRole() {
  try { return refs.autonomy?.accessState?.(refs.discordAuth?.getState?.())?.role || 'local-admin'; }
  catch { return 'local-admin'; }
}
function assertAccess(role, action) {
  if (refs.autonomy?.assertAccess) return refs.autonomy.assertAccess(refs.discordAuth?.getState?.(), role, action);
  const rank = { locked: 0, viewer: 1, operator: 2, owner: 3, 'local-admin': 3 };
  if ((rank[activeRole()] || 0) < (rank[role] || 0)) throw new Error(`${action} requires ${role} access.`);
  return true;
}
function actorId() { return String(refs.discordAuth?.getState?.().user?.id || 'local-owner'); }
function pushConfig() { refs.supervisor?.pushDndConfig?.(); broadcast(); }
function payload() {
  return {
    role: activeRole(),
    state: refs.configStore.getDndState(),
    registeredApps: refs.configStore.getRegisteredAppsPublic(),
    bot: refs.supervisor?.getState?.() || null,
    policy: {
      defaultSetupMode: 'none',
      categoryCreationEnabled: false,
      fullCampaignCategoryStatus: 'planned',
      message: 'Khaos Nexus will not automatically generate categories or extra campaign channels.'
    }
  };
}
function broadcast() {
  if (!refs.configStore) return;
  const state = payload();
  for (const window of electron.BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send('dnd:update', state);
}
function audit(action, input = {}) {
  const entry = refs.configStore.appendDndAudit({ action, outcome: input.outcome || 'success', actorId: actorId(), ...input });
  refs.logger?.write?.(entry.outcome === 'failed' ? 'error' : 'info', `D&D: ${action}`, { campaignId: entry.campaignId, targetId: entry.targetId }, 'dnd');
  return entry;
}

function registerIpc() {
  if (registerIpc.done || !refs.configStore || !refs.logger || !refs.supervisor) return false;
  registerIpc.done = true;
  const ipc = electron.ipcMain;

  ipc.handle('dnd:get', () => { assertAccess('viewer', 'View D&D campaigns'); return payload(); });
  ipc.handle('dnd:campaign-save', (_event, input) => { assertAccess('owner', 'Manage D&D campaigns'); const value = refs.configStore.upsertDndCampaign({ ...input, ownerUserId: input.ownerUserId || actorId() }); audit('campaign.saved', { campaignId: value.id, targetId: value.id }); pushConfig(); return payload(); });
  ipc.handle('dnd:member-save', (_event, input) => { assertAccess('owner', 'Manage D&D campaign members'); const value = refs.configStore.upsertDndMember(input); audit('member.saved', { campaignId: value.campaignId, targetId: value.id }); pushConfig(); return payload(); });
  ipc.handle('dnd:character-save', (_event, input) => { assertAccess('owner', 'Manage D&D characters'); const value = refs.configStore.upsertDndCharacter(input); audit('character.saved', { campaignId: value.campaignId, targetId: value.id }); pushConfig(); return payload(); });
  ipc.handle('dnd:source-toggle', (_event, input) => { assertAccess('owner', 'Manage D&D sources'); refs.configStore.mutateDnd((state) => { const index = state.campaignSources.findIndex((item) => item.campaignId === input.campaignId && item.sourceId === input.sourceId); const value = { id: index >= 0 ? state.campaignSources[index].id : id('campaign_source'), campaignId: clean(input.campaignId, 100), sourceId: clean(input.sourceId, 100), enabled: Boolean(input.enabled), updatedAt: nowIso() }; if (index >= 0) state.campaignSources[index] = value; else state.campaignSources.push(value); }); audit('source.toggled', { campaignId: input.campaignId, targetId: input.sourceId, metadata: { enabled: Boolean(input.enabled) } }); pushConfig(); return payload(); });

  ipc.handle('dnd:app-save', (_event, input) => { assertAccess('owner', 'Manage registered Discord apps'); const value = refs.configStore.upsertDiscordApp(input); audit('discord-app.saved', { appId: value.id, targetId: value.id }); pushConfig(); return payload(); });
  ipc.handle('dnd:app-token', (_event, input) => { assertAccess('owner', 'Change a registered Discord app token'); const result = refs.configStore.setDiscordAppToken(input.appId, input.token); audit('discord-app.token_changed', { appId: input.appId, targetId: input.appId, metadata: { removed: !input.token } }); pushConfig(); return { result, state: payload() }; });
  ipc.handle('dnd:guild-resources', (_event, input) => { assertAccess('owner', 'List Discord resources'); return ensureService().guildResources(input.appId, input.guildId); });
  ipc.handle('dnd:test-resource', (_event, input) => { assertAccess('owner', 'Test Discord campaign access'); return ensureService().testResource(input.appId, input.guildId, input.resourceId, input.resourceType); });
  ipc.handle('dnd:setup-save', async (_event, input) => { assertAccess('owner', 'Configure D&D Discord integration'); const result = await ensureService().saveSetup({ ...input, createdBy: actorId() }); audit('binding.saved', { campaignId: result.binding?.campaignId, targetId: result.binding?.id, appId: result.binding?.appId, guildId: result.binding?.guildId, metadata: { mode: result.mode, createdCount: result.createdCount } }); pushConfig(); return { result, state: payload() }; });
  ipc.handle('dnd:binding-remove', (_event, input) => { assertAccess('owner', 'Unbind a D&D Discord resource'); const binding = refs.configStore.getDndState().bindings.find((item) => item.id === input.bindingId); refs.configStore.removeDndItem('bindings', input.bindingId, { soft: true }); audit('binding.removed', { campaignId: binding?.campaignId, targetId: input.bindingId, appId: binding?.appId, guildId: binding?.guildId }); pushConfig(); return payload(); });
  ipc.handle('dnd:grant-save', (_event, input) => { assertAccess('owner', 'Manage D&D bot campaign scopes'); const value = refs.configStore.upsertDndGrant({ ...input, createdBy: actorId() }); audit('grant.changed', { campaignId: value.campaignId, targetId: value.id, appId: value.appId, guildId: value.guildId, metadata: { scopes: value.scopes } }); pushConfig(); return payload(); });
  ipc.handle('dnd:context-save', (_event, input) => { assertAccess('owner', 'Select shared-channel campaign context'); const value = refs.configStore.upsertDndContext({ ...input, selectedBy: actorId() }); audit('channel-context.changed', { campaignId: value.campaignId, targetId: value.id, appId: value.appId, guildId: value.guildId, metadata: { channelId: value.channelId } }); pushConfig(); return payload(); });
  ipc.handle('dnd:panel-refresh', async (_event, input) => { assertAccess('owner', 'Refresh a D&D campaign panel'); try { const result = await ensureService().refreshPanel(input.bindingId); audit('panel.refreshed', { targetId: input.bindingId, metadata: { unchanged: result.unchanged } }); pushConfig(); return { result, state: payload() }; } catch (error) { audit('panel.refreshed', { outcome: 'failed', targetId: input.bindingId, metadata: { error: error.code || error.message } }); throw error; } });

  ipc.handle('dnd:session-save', (_event, input) => { assertAccess('owner', 'Manage D&D sessions'); const value = refs.configStore.upsertDndSession(input); audit('session.saved', { campaignId: value.campaignId, targetId: value.id }); pushConfig(); return payload(); });
  ipc.handle('dnd:session-start', (_event, input) => { assertAccess('owner', 'Start a D&D session'); const value = refs.configStore.applyDndMutation({ operation: 'session.start', data: input }); audit('session.started', { campaignId: value.campaignId, targetId: value.id, metadata: { resetInitiative: Boolean(input.resetInitiative) } }); pushConfig(); return payload(); });
  ipc.handle('dnd:session-end', (_event, input) => { assertAccess('owner', 'End a D&D session'); const value = refs.configStore.applyDndMutation({ operation: 'session.end', data: input }); audit('session.ended', { campaignId: value.campaignId, targetId: value.id, metadata: { recapApprovalRequired: true } }); pushConfig(); return payload(); });
  ipc.handle('dnd:attendance-save', (_event, input) => { assertAccess('viewer', 'Update session attendance'); const value = refs.configStore.upsertDndAttendance(input); audit('attendance.changed', { campaignId: value.campaignId, targetId: value.id, metadata: { status: value.status } }); pushConfig(); return payload(); });

  return true;
}

function scheduleRegister() {
  clearTimeout(registerTimer);
  registerTimer = setTimeout(() => {
    if (!registerIpc()) scheduleRegister();
  }, 100);
  registerTimer.unref?.();
}

function install() {
  if (installed) return;
  installed = true;
  promoteCatalog();
  patchModuleRegistry();
  installRendererAssets();
  patchConfigStore();
  patchSupervisor();
  captureClass('./services/logger.cjs', 'AppLogger', 'logger');
  captureClass('./services/autonomy-service.cjs', 'AutonomyService', 'autonomy');
  captureClass('./services/discord-auth.cjs', 'DiscordAuth', 'discordAuth');
  scheduleRegister();
}

module.exports = { install };

'use strict';

const path = require('node:path');
const electron = require('electron');
const { normalizeDiscordEntitlementPolicy } = require('../shared/discord-entitlement-policy.cjs');
const { registerRendererBundle } = require('./renderer-asset-loader.cjs');

const refs = { configStore: null, supervisor: null };
let installed = false;
let handlersRegistered = false;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function ensurePolicy(store) {
  store.config.dnd ||= {};
  const normalized = normalizeDiscordEntitlementPolicy(store.config.dnd.monetization);
  const changed = JSON.stringify(store.config.dnd.monetization || null) !== JSON.stringify(normalized);
  store.config.dnd.monetization = normalized;
  if (changed) store.saveConfig();
  return normalized;
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__nexusDndMonetizationPatched) return;

  class DndMonetizationConfigStore extends Original {
    constructor(...args) {
      super(...args);
      refs.configStore = this;
      ensurePolicy(this);
    }

    getDndMonetizationPolicy() {
      return clone(ensurePolicy(this));
    }

    setDndMonetizationPolicy(input = {}) {
      this.config.dnd ||= {};
      this.config.dnd.monetization = normalizeDiscordEntitlementPolicy(input);
      this.saveConfig();
      return this.getDndMonetizationPolicy();
    }
  }

  Object.defineProperty(DndMonetizationConfigStore, '__nexusDndMonetizationPatched', { value: true });
  target.ConfigStore = DndMonetizationConfigStore;
}

function patchSupervisor() {
  const target = require('./services/bot-supervisor.cjs');
  const Original = target.BotSupervisor;
  if (!Original || Original.__nexusDndMonetizationCapturePatched) return;

  class DndMonetizationSupervisor extends Original {
    constructor(...args) {
      super(...args);
      refs.supervisor = this;
    }
  }

  Object.defineProperty(DndMonetizationSupervisor, '__nexusDndMonetizationCapturePatched', { value: true });
  target.BotSupervisor = DndMonetizationSupervisor;
}

function registerHandlers() {
  if (handlersRegistered) return;
  handlersRegistered = true;
  const { assertOwner } = require('./dnd-access-policy-extension.cjs');

  electron.ipcMain.handle('dnd:monetization-get', () => {
    assertOwner('View Discord Store rank configuration');
    return refs.configStore?.getDndMonetizationPolicy?.() || normalizeDiscordEntitlementPolicy();
  });

  electron.ipcMain.handle('dnd:monetization-set', (_event, input = {}) => {
    assertOwner('Change Discord Store rank configuration');
    if (!refs.configStore) throw new Error('D&D configuration store is not ready.');
    const policy = refs.configStore.setDndMonetizationPolicy(input);
    refs.configStore.appendDndAudit?.({
      action: 'discord-store.policy-changed',
      outcome: 'success',
      metadata: {
        enabled: policy.enabled,
        rankCount: policy.ranks.length,
        gatedFeatureCount: Object.keys(policy.featureRanks || {}).length
      }
    });
    refs.supervisor?.pushDndConfig?.();
    return policy;
  });
}

function installRendererAssets() {
  registerRendererBundle({
    id: 'dnd-discord-store-monetization',
    styles: [path.join(__dirname, '..', 'renderer', 'dnd-monetization.css')],
    scripts: [path.join(__dirname, '..', 'renderer', 'dnd-monetization.js')],
    source: 'dnd-monetization-extension.cjs'
  });
}

function install() {
  if (installed) return;
  installed = true;
  patchConfigStore();
  patchSupervisor();
  registerHandlers();
  installRendererAssets();
}

module.exports = { install, ensurePolicy };

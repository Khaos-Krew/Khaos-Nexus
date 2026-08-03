'use strict';

const { safeStorage } = require('electron');
const { ensureCoDmState } = require('../shared/dnd-co-dm.cjs');

let installed = false;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function captureCustomState(state = {}) {
  const campaignNotes = {};
  for (const campaign of Array.isArray(state.campaigns) ? state.campaigns : []) {
    if (campaign?.id && Object.prototype.hasOwnProperty.call(campaign, 'coDmNotes')) {
      campaignNotes[campaign.id] = String(campaign.coDmNotes || '').slice(0, 40000);
    }
  }
  return {
    coDmSettings: state.coDmSettings ? clone(state.coDmSettings) : null,
    coDmDrafts: Array.isArray(state.coDmDrafts) ? clone(state.coDmDrafts) : [],
    coDmServiceBindings: Array.isArray(state.coDmServiceBindings) ? clone(state.coDmServiceBindings) : [],
    campaignNotes
  };
}

function restoreCustomState(state, custom) {
  if (!state || !custom) return state;
  if (custom.coDmSettings) state.coDmSettings = clone(custom.coDmSettings);
  state.coDmDrafts = clone(custom.coDmDrafts || []);
  state.coDmServiceBindings = clone(custom.coDmServiceBindings || []);
  for (const campaign of Array.isArray(state.campaigns) ? state.campaigns : []) {
    if (campaign?.id && Object.prototype.hasOwnProperty.call(custom.campaignNotes || {}, campaign.id)) {
      campaign.coDmNotes = custom.campaignNotes[campaign.id];
    }
  }
  return state;
}

function sanitizeCoDmForExternal(state) {
  if (!state || typeof state !== 'object') return state;
  const safe = clone(state);
  delete safe.coDmSettings;
  delete safe.coDmDrafts;
  delete safe.coDmServiceBindings;
  safe.campaigns = (safe.campaigns || []).map((campaign) => {
    const value = { ...campaign };
    delete value.coDmNotes;
    return value;
  });
  return safe;
}

function install() {
  if (installed) return;
  installed = true;
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosDndCoDmPersistence) return;

  class DndCoDmPersistenceStore extends Original {
    getDndState() {
      const custom = captureCustomState(this.config?.dnd || {});
      const normalized = super.getDndState();
      restoreCustomState(normalized, custom);
      restoreCustomState(this.config.dnd, custom);
      ensureCoDmState(normalized);
      ensureCoDmState(this.config.dnd);
      this.saveConfig();
      return clone(normalized);
    }

    mutateDnd(mutator) {
      const before = captureCustomState(this.config?.dnd || {});
      let after = before;
      const result = super.mutateDnd((state) => {
        restoreCustomState(state, before);
        ensureCoDmState(state);
        const outcome = mutator(state);
        after = captureCustomState(state);
        return outcome;
      });
      restoreCustomState(this.config.dnd, after);
      ensureCoDmState(this.config.dnd);
      this.saveConfig();
      return result;
    }

    saveDndCoDmDraft(input = {}) {
      return super.saveDndCoDmDraft({ ...input, updatedAt: new Date().toISOString() });
    }

    upsertDndCampaign(input = {}) {
      const campaignId = String(input.id || '').trim();
      const current = campaignId ? this.getDndState().campaigns.find((item) => item.id === campaignId) : null;
      const coDmNotes = current?.coDmNotes;
      const saved = super.upsertDndCampaign(input);
      if (coDmNotes === undefined) return saved;
      return this.mutateDnd((state) => {
        const campaign = state.campaigns.find((item) => item.id === saved.id);
        if (!campaign) return saved;
        campaign.coDmNotes = String(coDmNotes).slice(0, 40000);
        return clone(campaign);
      });
    }

    getPublicConfig() {
      const config = super.getPublicConfig();
      if (config.dnd) config.dnd = sanitizeCoDmForExternal(config.dnd);
      return config;
    }

    exportSafeConfig() {
      return this.getPublicConfig();
    }

    getRuntimeBootstrap() {
      const bootstrap = super.getRuntimeBootstrap();
      if (bootstrap?.config?.dnd) bootstrap.config.dnd = sanitizeCoDmForExternal(bootstrap.config.dnd);
      return bootstrap;
    }

    getRegisteredBotBootstraps() {
      return super.getRegisteredBotBootstraps().map((bootstrap) => {
        const value = clone(bootstrap);
        if (value?.config?.dnd) value.config.dnd = sanitizeCoDmForExternal(value.config.dnd);
        return value;
      });
    }

    createBackupPayload(appVersion) {
      const payload = super.createBackupPayload(appVersion);
      const hasPrivateAiSecret = Boolean(this.secrets?.dndAiServiceToken || this.secrets?.dndCoDmOpenAiKey);
      if (!hasPrivateAiSecret) return payload;
      if (!safeStorage.isEncryptionAvailable()) {
        payload.encryptedSecrets = null;
        payload.note = `${payload.note} The Khaos Nexus AI service token and protected secrets were excluded because protected storage was unavailable.`;
        return payload;
      }
      const sanitized = { ...this.secrets };
      delete sanitized.dndAiServiceToken;
      delete sanitized.dndCoDmOpenAiKey;
      payload.encryptedSecrets = safeStorage.encryptString(JSON.stringify(sanitized)).toString('base64');
      payload.note = `${payload.note} The Khaos Nexus AI service token is intentionally excluded from backups.`;
      return payload;
    }
  }

  Object.defineProperty(DndCoDmPersistenceStore, '__khaosDndCoDmPersistence', { value: true });
  target.ConfigStore = DndCoDmPersistenceStore;
}

module.exports = {
  install,
  captureCustomState,
  restoreCustomState,
  sanitizeCoDmForExternal
};

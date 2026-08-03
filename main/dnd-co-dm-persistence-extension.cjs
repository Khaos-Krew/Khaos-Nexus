'use strict';

const { safeStorage } = require('electron');

let installed = false;

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function install() {
  if (installed) return;
  installed = true;
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosDndCoDmPersistence) return;

  class DndCoDmPersistenceStore extends Original {
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

    createBackupPayload(appVersion) {
      const payload = super.createBackupPayload(appVersion);
      if (!this.secrets?.dndCoDmOpenAiKey) return payload;
      if (!safeStorage.isEncryptionAvailable()) {
        payload.encryptedSecrets = null;
        payload.note = `${payload.note} The D&D Co-DM API key and protected secrets were excluded because protected storage was unavailable.`;
        return payload;
      }
      const sanitized = { ...this.secrets };
      delete sanitized.dndCoDmOpenAiKey;
      payload.encryptedSecrets = safeStorage.encryptString(JSON.stringify(sanitized)).toString('base64');
      payload.note = `${payload.note} The D&D Co-DM API key is intentionally excluded from backups.`;
      return payload;
    }
  }

  Object.defineProperty(DndCoDmPersistenceStore, '__khaosDndCoDmPersistence', { value: true });
  target.ConfigStore = DndCoDmPersistenceStore;
}

module.exports = { install };

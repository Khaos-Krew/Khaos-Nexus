'use strict';

const {
  normalizeDiscordResource,
  replaceInitiativeCombatant,
  assertSessionStartable
} = require('../shared/dnd-runtime-integrity.cjs');

let installed = false;

function patchCampaignService() {
  const target = require('./services/dnd-campaign-service.cjs');
  const Service = target.DndCampaignService;
  if (!Service || Service.prototype.__khaosDndResourcePolicyPatched) return;

  const originalGuildResources = Service.prototype.guildResources;
  Service.prototype.guildResources = async function normalizedGuildResources(...args) {
    const resources = await originalGuildResources.apply(this, args);
    return resources.map(normalizeDiscordResource);
  };

  const originalTestResource = Service.prototype.testResource;
  Service.prototype.testResource = async function normalizedTestResource(...args) {
    const result = await originalTestResource.apply(this, args);
    return normalizeDiscordResource(result);
  };

  Object.defineProperty(Service.prototype, '__khaosDndResourcePolicyPatched', { value: true });
}

function patchConfigStore() {
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosDndRuntimeIntegrityPatched) return;

  class DndRuntimeIntegrityConfigStore extends Original {
    applyDndMutation(input = {}) {
      const operation = String(input.operation || '');
      const data = input.data || {};
      if (operation === 'initiative.join') {
        return this.mutateDnd((state) => replaceInitiativeCombatant(state, data));
      }
      if (operation === 'session.start') {
        assertSessionStartable(this.getDndState(), data.sessionId);
      }
      return super.applyDndMutation(input);
    }
  }

  Object.defineProperty(DndRuntimeIntegrityConfigStore, '__khaosDndRuntimeIntegrityPatched', { value: true });
  target.ConfigStore = DndRuntimeIntegrityConfigStore;
}

function install() {
  if (installed) return;
  installed = true;
  patchCampaignService();
  patchConfigStore();
}

module.exports = { install };

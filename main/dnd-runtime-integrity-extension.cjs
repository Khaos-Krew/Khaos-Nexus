'use strict';

const {
  normalizeDiscordResource,
  initiativeOrder,
  clampInitiativeIndex,
  primeEncounterTurn,
  replaceInitiativeCombatant,
  assertSessionStartable,
  assertSessionEndable
} = require('../shared/dnd-runtime-integrity.cjs');

let installed = false;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function patchCampaignService() {
  const target = require('./services/dnd-campaign-service.cjs');
  const Service = target.DndCampaignService;
  if (!Service || Service.prototype.__khaosDndResourcePolicyPatched) return;

  const originalGuildResources = Service.prototype.guildResources;
  Service.prototype.guildResources = async function normalizedGuildResources(...args) {
    const resources = await originalGuildResources.apply(this, args);
    return (Array.isArray(resources) ? resources : []).map(normalizeDiscordResource);
  };

  const originalTestResource = Service.prototype.testResource;
  Service.prototype.testResource = async function normalizedTestResource(...args) {
    const result = await originalTestResource.apply(this, args);
    return normalizeDiscordResource(result);
  };

  Object.defineProperty(Service.prototype, '__khaosDndResourcePolicyPatched', { value: true });
}

function persistInitiativeTurn(state, data = {}) {
  const encounter = (state.encounters || []).find((item) => item.id === data.encounterId);
  if (!encounter) {
    const error = new Error('Encounter not found.');
    error.code = 'ENCOUNTER_NOT_FOUND';
    throw error;
  }

  const order = initiativeOrder((state.combatants || []).filter((item) => item.encounterId === encounter.id));
  const currentTurnIndex = order.length
    ? clampInitiativeIndex(data.currentTurnIndex, order.length)
    : 0;

  encounter.currentTurnIndex = currentTurnIndex;
  encounter.currentCombatantId = String(order[currentTurnIndex]?.id || '');
  encounter.round = Math.max(1, Number(data.round || 1));
  encounter.updatedAt = new Date().toISOString();
  return clone(encounter);
}

function primeCampaignEncounters(state, campaignId) {
  for (const encounter of (state.encounters || []).filter((item) => item.campaignId === campaignId && item.status === 'active')) {
    const combatants = (state.combatants || []).filter((item) => item.encounterId === encounter.id);
    primeEncounterTurn(encounter, combatants);
    encounter.updatedAt = new Date().toISOString();
  }
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

      if (operation === 'initiative.next') {
        return this.mutateDnd((state) => persistInitiativeTurn(state, data));
      }

      if (operation === 'session.start') {
        const session = assertSessionStartable(this.getDndState(), data.sessionId);
        const result = super.applyDndMutation(input);
        if (data.resetInitiative) {
          this.mutateDnd((state) => {
            primeCampaignEncounters(state, session.campaignId);
            return true;
          });
        }
        return result;
      }

      if (operation === 'session.end') {
        assertSessionEndable(this.getDndState(), data.sessionId);
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

module.exports = { install, persistInitiativeTurn, primeCampaignEncounters };

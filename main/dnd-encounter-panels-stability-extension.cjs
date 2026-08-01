'use strict';

const { ensureEncounterPanelCollections } = require('../shared/dnd-encounter-panels.cjs');

let installed = false;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function nowIso() { return new Date().toISOString(); }
function integer(value, fallback = 0) {
  const result = Number(value);
  return Number.isFinite(result) ? Math.trunc(result) : fallback;
}

function install() {
  if (installed) return;
  installed = true;
  const target = require('./services/config-store.cjs');
  const Original = target.ConfigStore;
  if (!Original || Original.__khaosDndEncounterPanelsStable) return;

  class StableDndEncounterPanelsConfigStore extends Original {
    saveDndEncounterPanel(input = {}) {
      if (Object.prototype.hasOwnProperty.call(input, 'autoRefresh')) {
        this.mutateDnd((state) => {
          ensureEncounterPanelCollections(state);
          const existing = input.id
            ? state.encounterPanels.find((item) => item.id === input.id)
            : state.encounterPanels.find((item) => item.encounterId === input.encounterId && item.bindingId === input.bindingId);
          if (existing) existing.autoRefresh = input.autoRefresh !== false;
          return true;
        });
      }
      return super.saveDndEncounterPanel(input);
    }

    patchDndCombatant(input = {}) {
      return this.mutateDnd((state) => {
        ensureEncounterPanelCollections(state);
        const combatant = (state.combatants || []).find((item) => item.id === input.combatantId && item.encounterId === input.encounterId);
        if (!combatant) throw Object.assign(new Error('Combatant was not found in this encounter.'), { code: 'DND_COMBATANT_NOT_FOUND' });
        const hasHp = Object.prototype.hasOwnProperty.call(input, 'hp');
        const hasMaxHp = Object.prototype.hasOwnProperty.call(input, 'maxHp');
        const nextMaxHp = hasMaxHp ? integer(input.maxHp, Number.NaN) : combatant.maxHp;
        const nextHp = hasHp ? integer(input.hp, Number.NaN) : combatant.hp;
        if (hasMaxHp && (!Number.isFinite(nextMaxHp) || nextMaxHp < 0)) throw Object.assign(new Error('Combatant maximum HP is invalid.'), { code: 'DND_COMBATANT_HP_INVALID' });
        if (hasHp && (!Number.isFinite(nextHp) || nextHp < 0)) throw Object.assign(new Error('Combatant HP is invalid.'), { code: 'DND_COMBATANT_HP_INVALID' });
        if (nextHp !== null && nextHp !== undefined && nextMaxHp !== null && nextMaxHp !== undefined && nextHp > nextMaxHp) throw Object.assign(new Error('Combatant HP cannot exceed maximum HP.'), { code: 'DND_COMBATANT_HP_INVALID' });
        if (hasMaxHp) combatant.maxHp = nextMaxHp;
        if (hasHp) combatant.hp = nextHp;
        if (Object.prototype.hasOwnProperty.call(input, 'conditions')) {
          combatant.conditions = [...new Set((Array.isArray(input.conditions) ? input.conditions : String(input.conditions || '').split(',')).map((item) => String(item || '').trim().slice(0, 80)).filter(Boolean))];
        }
        combatant.updatedAt = nowIso();
        for (const panel of state.encounterPanels.filter((item) => item.encounterId === combatant.encounterId && item.autoRefresh)) {
          panel.requestedAt = nowIso();
          panel.updatedAt = nowIso();
        }
        return clone(combatant);
      });
    }
  }

  Object.defineProperty(StableDndEncounterPanelsConfigStore, '__khaosDndEncounterPanelsStable', { value: true });
  target.ConfigStore = StableDndEncounterPanelsConfigStore;
}

module.exports = { install };

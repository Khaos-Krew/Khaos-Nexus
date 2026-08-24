'use strict';

const KNOWN_BASE_MINUTES = Object.freeze({
  rex: 96,
  giga: 240,
  carcharodontosaurus: 210,
  argy: 72,
  argentavis: 72,
  ankylosaurus: 48,
  doedicurus: 44,
  therizinosaurus: 132,
  yutyrannus: 168
});

function cleanCreature(value) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

function cleanFood(value) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}

function creatureSlug(value) {
  return cleanCreature(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function positiveNumber(value, name, { min = 0.1, max = 10000 } = {}) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    throw new Error(`${name} must be a number from ${min} to ${max}.`);
  }
  return number;
}

function positiveInteger(value, name, { min = 1, max = 1000 } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) {
    throw new Error(`${name} must be a whole number from ${min} to ${max}.`);
  }
  return number;
}

function estimateTameMinutes(baseMinutes, tamingRate, foodDrainRate = 1) {
  const base = positiveNumber(baseMinutes, 'Base tame minutes', { min: 1, max: 10000 });
  const rate = positiveNumber(tamingRate, 'Taming rate', { min: 0.1, max: 100 });
  const foodDrain = positiveNumber(foodDrainRate, 'Food drain rate', { min: 0.01, max: 100 });
  return Math.max(1, Math.round(base / (rate * foodDrain)));
}

function dododexUrl(creature, tamingRate) {
  const slug = creatureSlug(creature);
  if (!slug) throw new Error('Creature name is required.');
  const rate = positiveNumber(tamingRate, 'Taming rate', { min: 0.1, max: 100 });
  const url = new URL(`https://www.dododex.com/taming/${slug}`);
  url.searchParams.set('taming', String(rate));
  return url.toString();
}

function knownBaseMinutes(creature) {
  return KNOWN_BASE_MINUTES[creatureSlug(creature)] || null;
}

class ArkCompanionService {
  constructor() {
    this.supportedActions = Object.freeze(['taming']);
  }

  async invoke(moduleId, actionId, payload = {}) {
    if (moduleId !== 'ark' || actionId !== 'taming') throw new Error('Unsupported ARK companion action.');

    const creature = cleanCreature(payload.creature || payload.input);
    if (!creature) throw new Error('Creature name is required.');

    const wildLevel = positiveInteger(payload.wildLevel ?? payload.level, 'Wild level', { min: 1, max: 1000 });
    const food = cleanFood(payload.food);
    if (!food) throw new Error('Taming food is required.');

    const tamingRate = positiveNumber(payload.tamingRate ?? payload.rate, 'Taming rate', { min: 0.1, max: 100 });
    const foodDrainRate = positiveNumber(payload.foodDrainRate ?? payload.foodDrain, 'Food drain rate', { min: 0.01, max: 100 });
    const suppliedBase = payload.baseMinutes === null || payload.baseMinutes === undefined || payload.baseMinutes === ''
      ? null
      : positiveNumber(payload.baseMinutes, 'Base tame minutes', { min: 1, max: 10000 });
    const baseMinutes = suppliedBase || knownBaseMinutes(creature);
    const url = dododexUrl(creature, tamingRate);

    const common = {
      creature,
      wildLevel,
      food,
      tamingRate,
      foodDrainRate,
      dododexUrl: url,
      dododexNote: 'Open Dododex for the selected creature and verify the same Taming Speed and Dino Character Food Drain values for the exact level/food calculation.'
    };

    if (!baseMinutes) {
      return {
        ...common,
        estimateAvailable: false,
        estimateNote: 'No Nexus reference base time is stored for this creature, so Nexus will not invent a tame-time estimate. Use Dododex with the values above for the exact calculation.'
      };
    }

    return {
      ...common,
      baseMinutes,
      estimatedMinutes: estimateTameMinutes(baseMinutes, tamingRate, foodDrainRate),
      estimateNote: 'Rate-adjusted planning reference only. The local reference does not model the selected creature level, food-specific affinity, passive-tame rules, or every species mechanic; use Dododex for the exact tame calculation.'
    };
  }
}

module.exports = {
  ArkCompanionService,
  KNOWN_BASE_MINUTES,
  cleanCreature,
  cleanFood,
  creatureSlug,
  dododexUrl,
  estimateTameMinutes,
  knownBaseMinutes,
  positiveInteger,
  positiveNumber
};

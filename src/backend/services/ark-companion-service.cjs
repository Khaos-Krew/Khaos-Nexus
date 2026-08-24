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

function estimateTameMinutes(baseMinutes, tamingRate) {
  const base = positiveNumber(baseMinutes, 'Base tame minutes', { min: 1, max: 10000 });
  const rate = positiveNumber(tamingRate, 'Taming rate', { min: 0.1, max: 100 });
  return Math.max(1, Math.round(base / rate));
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
    const tamingRate = positiveNumber(payload.tamingRate ?? payload.rate, 'Taming rate', { min: 0.1, max: 100 });
    const suppliedBase = payload.baseMinutes === null || payload.baseMinutes === undefined || payload.baseMinutes === ''
      ? null
      : positiveNumber(payload.baseMinutes, 'Base tame minutes', { min: 1, max: 10000 });
    const baseMinutes = suppliedBase || knownBaseMinutes(creature);
    const url = dododexUrl(creature, tamingRate);

    if (!baseMinutes) {
      return {
        creature,
        tamingRate,
        estimateAvailable: false,
        estimateNote: 'No built-in 1x base time is stored for this creature. Add base-minutes for a rough estimate, or use Dododex for the full food/level calculation.',
        dododexUrl: url
      };
    }

    return {
      creature,
      tamingRate,
      baseMinutes,
      estimatedMinutes: estimateTameMinutes(baseMinutes, tamingRate),
      estimateNote: suppliedBase
        ? 'Rough planning estimate from the base time you supplied; Dododex remains authoritative for food, level, effectiveness, and exact timing.'
        : 'Rough planning estimate from a recovered Nexus reference base time; Dododex remains authoritative for food, level, effectiveness, and exact timing.',
      dododexUrl: url
    };
  }
}

module.exports = {
  ArkCompanionService,
  KNOWN_BASE_MINUTES,
  cleanCreature,
  creatureSlug,
  dododexUrl,
  estimateTameMinutes,
  knownBaseMinutes,
  positiveNumber
};

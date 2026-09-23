'use strict';

const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_CREATURES = Object.freeze([
  { id: 'rex', name: 'Rex', mateMinutes: 1080, hatchMinutes: 300, matureMinutes: 4860 },
  { id: 'therizino', name: 'Therizinosaur', mateMinutes: 1080, hatchMinutes: 300, matureMinutes: 4860 },
  { id: 'wyvern', name: 'Wyvern', mateMinutes: 1080, hatchMinutes: 300, matureMinutes: 5550 }
]);

const BOSS_CHECKLIST = Object.freeze([
  'Confirm the tribute items and that the obelisk or terminal is the one your tribe intends to use.',
  'Bring a rider for each creature and a spare set of armor.',
  'Bring medical brews and a way home if the teleport fails.',
  'Agree on the element and who loots before you start.',
  'This checklist does not start the fight or spend Nexus Points.'
]);

function defaultCard() {
  return {
    taming: '5x',
    breeding: '10x',
    harvest: '3x',
    xp: '3x',
    note: 'Planning card. Confirm live server rates before a breed or boss run.',
    creatures: DEFAULT_CREATURES.map((creature) => ({ ...creature }))
  };
}

function rateNumber(value) {
  const match = String(value || '').trim().match(/^(\d+(?:\.\d+)?)x?$/i);
  const rate = match ? Number(match[1]) : NaN;
  if (!Number.isFinite(rate) || rate <= 0 || rate > 1000) return null;
  return rate;
}

function formatRate(value) {
  const rate = rateNumber(value);
  if (rate == null) return null;
  return `${rate}x`;
}

function formatMinutes(minutes) {
  const total = Math.max(0, Math.round(Number(minutes) || 0));
  const days = Math.floor(total / 1440);
  const hours = Math.floor((total % 1440) / 60);
  const mins = total % 60;
  const parts = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (mins || !parts.length) parts.push(`${mins}m`);
  return parts.join(' ');
}

function breedLine(creature, breedingRate) {
  const rate = rateNumber(breedingRate) || 1;
  return {
    name: creature.name,
    mate: formatMinutes(creature.mateMinutes),
    hatch: formatMinutes(creature.hatchMinutes / rate),
    mature: formatMinutes(creature.matureMinutes / rate)
  };
}

class RateCardStore {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'ascended-rate-cards.json');
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const base = defaultCard();
      return {
        taming: formatRate(parsed.taming) || base.taming,
        breeding: formatRate(parsed.breeding) || base.breeding,
        harvest: formatRate(parsed.harvest) || base.harvest,
        xp: formatRate(parsed.xp) || base.xp,
        note: String(parsed.note || base.note).replace(/[\r\n]/g, ' ').trim().slice(0, 200),
        creatures: base.creatures
      };
    } catch {
      return defaultCard();
    }
  }

  write(card) {
    const current = this.read();
    const next = {
      taming: formatRate(card.taming) || current.taming,
      breeding: formatRate(card.breeding) || current.breeding,
      harvest: formatRate(card.harvest) || current.harvest,
      xp: formatRate(card.xp) || current.xp,
      note: String(card.note ?? current.note).replace(/[\r\n]/g, ' ').trim().slice(0, 200)
    };
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.file, `${JSON.stringify(next, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
    return this.read();
  }
}

function ratesText(card) {
  return [
    '**ARK rate card**',
    `Taming ${card.taming} • Breeding ${card.breeding} • Harvest ${card.harvest} • XP ${card.xp}`,
    card.note,
    '',
    'Breed timers and the boss checklist: `/rates breed` and `/rates boss`.',
    'Staff edit this card in Discord. It is one JSON file, not a second database.',
    'Wallet and ranks stay on Nexus Sentinal.'
  ].join('\n');
}

function breedText(card, creatureId) {
  const creature = card.creatures.find((item) => item.id === creatureId) || card.creatures[0];
  const line = breedLine(creature, card.breeding);
  return [
    `**${line.name} breed timer**`,
    `Mating interval ${line.mate} (not scaled).`,
    `Incubation or gestation ${line.hatch} at ${card.breeding}.`,
    `Maturation ${line.mature} at ${card.breeding}.`,
    'Planning estimate. Confirm on the server before you start a breed.'
  ].join('\n');
}

function bossText() {
  return ['**ARK boss checklist**', ...BOSS_CHECKLIST.map((item) => `• ${item}`)].join('\n');
}

module.exports = {
  DEFAULT_CREATURES,
  BOSS_CHECKLIST,
  defaultCard,
  rateNumber,
  formatMinutes,
  breedLine,
  RateCardStore,
  ratesText,
  breedText,
  bossText
};

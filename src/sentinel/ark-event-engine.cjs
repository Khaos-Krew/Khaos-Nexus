'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const EVENT_TYPES = Object.freeze({
  supplyRush: Object.freeze({
    id: 'supply-rush',
    label: 'Nexus Supply Rush',
    durationMinutes: 30,
    cooldownMinutes: 240,
    weight: 30,
    rewardCache: 'event',
    description: 'Sentinel announces a limited-time hunt for server-approved supply or reward locations.'
  }),
  alphaHunt: Object.freeze({
    id: 'alpha-hunt',
    label: 'Alpha Hunt',
    durationMinutes: 45,
    cooldownMinutes: 360,
    weight: 25,
    rewardCache: 'event',
    description: 'Players hunt dangerous naturally spawned targets while Sentinel tracks the event window and rewards.'
  }),
  anomalySurge: Object.freeze({
    id: 'anomaly-surge',
    label: 'Nexus Anomaly Surge',
    durationMinutes: 60,
    cooldownMinutes: 720,
    weight: 15,
    rewardCache: 'event',
    description: 'A rare encounter window for Sentinel-managed special creatures or manually verified anomaly spawns.'
  }),
  bloodMoon: Object.freeze({
    id: 'blood-moon',
    label: 'Blood Moon',
    durationMinutes: 60,
    cooldownMinutes: 720,
    weight: 10,
    rewardCache: 'event',
    description: 'A themed high-risk server event using announcements, boosted objectives, and reward multipliers without permanent power rewards.'
  }),
  communityGoal: Object.freeze({
    id: 'community-goal',
    label: 'Nexus Community Goal',
    durationMinutes: 90,
    cooldownMinutes: 360,
    weight: 20,
    rewardCache: 'event',
    description: 'A cooperative objective suitable for resource turn-ins, boss prep, taming, or map-specific goals.'
  })
});

const ANOMALY_TIERS = Object.freeze([
  Object.freeze({ id: 'rare', label: 'Aberrant', weight: 62, rewardMultiplier: 1.0, maxLevelBonus: 10 }),
  Object.freeze({ id: 'very-rare', label: 'Corrupted', weight: 24, rewardMultiplier: 1.25, maxLevelBonus: 20 }),
  Object.freeze({ id: 'epic', label: 'Nexus-Touched', weight: 10, rewardMultiplier: 1.5, maxLevelBonus: 30 }),
  Object.freeze({ id: 'legendary', label: 'Anomaly', weight: 3.5, rewardMultiplier: 2.0, maxLevelBonus: 40 }),
  Object.freeze({ id: 'ultra', label: 'Nexus Ascendant', weight: 0.5, rewardMultiplier: 3.0, maxLevelBonus: 50 })
]);

const DEFAULT_ANOMALY_SPECIES = Object.freeze([
  Object.freeze({ id: 'rex', label: 'Rex', blueprint: '/Game/PrimalEarth/Dinos/Rex/Rex_Character_BP.Rex_Character_BP', weight: 25 }),
  Object.freeze({ id: 'allosaurus', label: 'Allosaurus', blueprint: '/Game/PrimalEarth/Dinos/Allosaurus/Allo_Character_BP.Allo_Character_BP', weight: 20 }),
  Object.freeze({ id: 'spino', label: 'Spinosaurus', blueprint: '/Game/PrimalEarth/Dinos/Spino/Spino_Character_BP.Spino_Character_BP', weight: 15 }),
  Object.freeze({ id: 'yutyrannus', label: 'Yutyrannus', blueprint: '/Game/PrimalEarth/Dinos/Yutyrannus/Yutyrannus_Character_BP.Yutyrannus_Character_BP', weight: 14 }),
  Object.freeze({ id: 'basilosaurus', label: 'Basilosaurus', blueprint: '/Game/PrimalEarth/Dinos/Basilosaurus/Basilosaurus_Character_BP.Basilosaurus_Character_BP', weight: 10 }),
  Object.freeze({ id: 'mosasaurus', label: 'Mosasaurus', blueprint: '/Game/PrimalEarth/Dinos/Mosasaurus/Mosa_Character_BP.Mosa_Character_BP', weight: 8 }),
  Object.freeze({ id: 'carchar', label: 'Carcharodontosaurus', blueprint: '/Game/PrimalEarth/Dinos/Carcharodontosaurus/Carcha_Character_BP.Carcha_Character_BP', weight: 5 }),
  Object.freeze({ id: 'giga', label: 'Giganotosaurus', blueprint: '/Game/PrimalEarth/Dinos/Giganotosaurus/Gigant_Character_BP.Gigant_Character_BP', weight: 3 })
]);

function randomFloat() {
  return crypto.randomInt(0, 1_000_000_000) / 1_000_000_000;
}

function normalizeRng(rng) {
  const fn = typeof rng === 'function' ? rng : randomFloat;
  return () => {
    const n = Number(fn());
    if (!Number.isFinite(n) || n < 0 || n >= 1) throw new Error('Event RNG must produce a number in [0, 1).');
    return n;
  };
}

function weightedPick(items, rngInput) {
  const rng = normalizeRng(rngInput);
  const list = Array.isArray(items) ? items : [];
  if (!list.length) throw new Error('Cannot choose from an empty event list.');
  const total = list.reduce((sum, item) => sum + Math.max(0, Number(item.weight) || 0), 0);
  if (!(total > 0)) throw new Error('Event list has no positive weight.');
  let cursor = rng() * total;
  for (const item of list) {
    cursor -= Math.max(0, Number(item.weight) || 0);
    if (cursor < 0) return item;
  }
  return list.at(-1);
}

function chooseEvent(options = {}) {
  const disabled = new Set((options.disabled || []).map((value) => String(value).toLowerCase()));
  const pool = Object.values(EVENT_TYPES).filter((event) => !disabled.has(event.id));
  return Object.freeze({ ...weightedPick(pool, options.rng) });
}

function rollAnomaly(options = {}) {
  const speciesPool = options.speciesPool || DEFAULT_ANOMALY_SPECIES;
  const tier = weightedPick(ANOMALY_TIERS, options.rng);
  const species = weightedPick(speciesPool, options.rng);
  const baseMaxLevel = Math.max(1, Number(options.baseMaxLevel) || 150);
  const level = baseMaxLevel + tier.maxLevelBonus;
  return Object.freeze({
    id: crypto.randomUUID(),
    tierId: tier.id,
    tier: tier.label,
    speciesId: species.id,
    species: species.label,
    blueprint: species.blueprint,
    targetLevel: level,
    rewardMultiplier: tier.rewardMultiplier,
    announcement: `⚠️ NEXUS ANOMALY DETECTED — ${tier.label} ${species.label} — Threat Level ${tier.id.toUpperCase()}`,
    createdAt: new Date().toISOString()
  });
}

function buildBroadcastPlan(event, mapName = 'ARK') {
  if (!event?.id) throw new Error('Event is required.');
  return Object.freeze([
    `Broadcast [${mapName}] ${event.label} begins now.`,
    `Broadcast ${event.description}`,
    `Broadcast Event window: ${event.durationMinutes} minutes.`
  ]);
}

function buildAnomalyPlan(anomaly, mapName = 'ARK') {
  if (!anomaly?.blueprint) throw new Error('Anomaly roll is required.');
  return Object.freeze({
    safeByDefault: true,
    autoSpawn: false,
    mapName,
    announcementCommands: Object.freeze([
      `Broadcast [${mapName}] ${anomaly.announcement}`,
      `Broadcast The anomaly is level ${anomaly.targetLevel}. Rewards are boosted x${anomaly.rewardMultiplier}.`
    ]),
    proposedSpawn: Object.freeze({
      blueprint: anomaly.blueprint,
      level: anomaly.targetLevel
    })
  });
}

function clean(value, max = 96) {
  return String(value || '').replace(/[\r\n\t]/g, ' ').trim().slice(0, max);
}

class EventJournal {
  constructor(root = process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..', 'data')) {
    this.dir = path.resolve(root);
    this.file = path.join(this.dir, 'ark-event-journal.json');
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return { version: 1, events: Array.isArray(parsed?.events) ? parsed.events.slice(-5000) : [] };
    } catch {
      return { version: 1, events: [] };
    }
  }

  write(state) {
    fs.mkdirSync(this.dir, { recursive: true });
    const safe = { version: 1, updatedAt: new Date().toISOString(), events: (state.events || []).slice(-5000) };
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(safe, null, 2));
    fs.renameSync(tmp, this.file);
    return safe;
  }

  start({ eventId, mapName, source = 'sentinel', metadata = {} } = {}) {
    const item = {
      id: crypto.randomUUID(),
      eventId: clean(eventId, 64),
      mapName: clean(mapName, 64),
      source: clean(source, 32),
      state: 'active',
      metadata,
      startedAt: new Date().toISOString(),
      endedAt: ''
    };
    if (!item.eventId || !item.mapName) throw new Error('Event journal start requires event id and map name.');
    const state = this.read();
    state.events.push(item);
    this.write(state);
    return JSON.parse(JSON.stringify(item));
  }

  finish(id, metadata = {}) {
    const state = this.read();
    const item = state.events.find((entry) => entry.id === id);
    if (!item) throw new Error('Unknown event journal id.');
    if (item.state !== 'active') throw new Error(`Cannot finish event from state ${item.state}.`);
    item.state = 'finished';
    item.endedAt = new Date().toISOString();
    item.metadata = { ...(item.metadata || {}), ...(metadata || {}) };
    this.write(state);
    return JSON.parse(JSON.stringify(item));
  }
}

module.exports = {
  EVENT_TYPES,
  ANOMALY_TIERS,
  DEFAULT_ANOMALY_SPECIES,
  weightedPick,
  chooseEvent,
  rollAnomaly,
  buildBroadcastPlan,
  buildAnomalyPlan,
  EventJournal
};

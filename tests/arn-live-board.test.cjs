'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  RESOLVED_LINGER_MS,
  parseShinyDiscordPayload,
  classifyThreat,
  applyEvent,
  sortedAnomalies,
  boardEmbed,
  resetArnStateForTest
} = require('../src/sentinel/arn-live-board-extension.cjs');

test.beforeEach(() => resetArnStateForTest());

test('parses the observed Astraeos Shiny detection payload with authoritative webhook map', () => {
  const event = parseShinyDiscordPayload({
    embeds: [{
      title: '🧬ANOMALY DETECTED',
      description: 'Rainbow Manta detected on Astraeos at Lat 38 / Lon 90.',
      footer: { text: 'Anomaly Response Network • Khaos Nexus (Astraeos)' }
    }]
  }, 'Astraeos');

  assert.deepEqual(event && {
    lifecycle: event.lifecycle,
    dinoName: event.dinoName,
    mapName: event.mapName,
    lat: event.lat,
    lon: event.lon
  }, {
    lifecycle: 'ACTIVE',
    dinoName: 'Rainbow Manta',
    mapName: 'Astraeos',
    lat: 38,
    lon: 90
  });
});

test('webhook identity wins over footer and description map text', () => {
  const event = parseShinyDiscordPayload({
    embeds: [{
      title: 'ANOMALY DETECTED',
      description: 'Enraged Rex detected on Genesis at Lat 10 / Lon 20.',
      footer: { text: 'Anomaly Response Network • Khaos Nexus (Genesis 1)' }
    }]
  }, 'Astraeos');
  assert.equal(event.mapName, 'Astraeos');
});

test('Enraged is KAIJU while appearance names do not invent threat tiers', () => {
  assert.equal(classifyThreat('Enraged Rex').level, 'KAIJU');
  assert.equal(classifyThreat('Rainbow Manta').level, 'WATCH');
  assert.equal(classifyThreat('Luna Sabertooth').level, 'WATCH');
});

test('signal lost resolves an active anomaly and it lingers before pruning', () => {
  const now = 1_800_000_000_000;
  applyEvent({ lifecycle: 'ACTIVE', dinoName: 'Luna Sabertooth', mapName: 'Genesis 1', lat: 25, lon: 40 }, now);
  applyEvent({ lifecycle: 'SIGNAL_LOST', dinoName: 'Luna Sabertooth', mapName: 'Genesis 1', lat: null, lon: null }, now + 1000);

  let items = sortedAnomalies(now + 2000);
  assert.equal(items.length, 1);
  assert.equal(items[0].status, 'SIGNAL LOST');

  items = sortedAnomalies(now + 1000 + RESOLVED_LINGER_MS);
  assert.equal(items.length, 0);
});

test('board sorts active KAIJU ahead of standard active anomalies', () => {
  const now = 1_800_000_000_000;
  applyEvent({ lifecycle: 'ACTIVE', dinoName: 'Rainbow Manta', mapName: 'Astraeos', lat: 38, lon: 90 }, now);
  applyEvent({ lifecycle: 'ACTIVE', dinoName: 'Enraged Rex', mapName: 'Genesis 1', lat: 12, lon: 44 }, now + 1000);

  const items = sortedAnomalies(now + 2000);
  assert.equal(items[0].dinoName, 'Enraged Rex');
  assert.equal(items[0].threat.level, 'KAIJU');
  const embed = boardEmbed(now + 2000);
  assert.match(embed.description, /2 active anomalies/);
  assert.ok(embed.fields.some((field) => /Genesis 1/.test(field.name) && /KAIJU/.test(field.value)));
  assert.ok(embed.fields.some((field) => /Astraeos/.test(field.name) && /Rainbow Manta/.test(field.value)));
});

test('parses native signal-lost payload using authoritative webhook map', () => {
  const event = parseShinyDiscordPayload({
    embeds: [{
      title: '📡 SIGNAL LOST',
      description: 'Luna Sabertooth is no longer detectable on the network.',
      footer: { text: 'Anomaly Response Network • Khaos Nexus (Genesis 1)' }
    }]
  }, 'Genesis 1');
  assert.equal(event.lifecycle, 'SIGNAL_LOST');
  assert.equal(event.dinoName, 'Luna Sabertooth');
  assert.equal(event.mapName, 'Genesis 1');
});

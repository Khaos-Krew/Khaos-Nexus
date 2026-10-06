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
  rawMessagePayload,
  runArnLiveBoardSetup,
  installArnLiveBoardExtension,
  SETUP_DELAY_MS,
  resetArnStateForTest
} = require('../src/sentinel/arn-live-board-extension.cjs');
const { parseArnReport } = require('../src/sentinel/arn-report-parser.cjs');

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
  assert.match(embed.description, /2 active.*anomalies/);
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

test('shiny webhook embeds parse when message content is empty', async () => {
  const payload = { content: '', embeds: [{ description: '**Filthy Pastel Dodo** has been tamed by Player!' }] };
  const event = parseShinyDiscordPayload(payload, 'Astraeos');
  assert.equal(event.lifecycle, 'CAPTURED');
  assert.equal(event.dinoName, 'Filthy Pastel Dodo');
  assert.equal(event.mapName, 'Astraeos');
  const report = parseArnReport(payload, 'Astraeos');
  assert.equal(report.ok, true);
  assert.equal(report.kind, 'tame');
  assert.equal(report.playerName, 'Player');
  const message = { channelId: '10', id: '20', content: '', embeds: [] };
  const restored = await rawMessagePayload({
    rest: { async get() { return payload; } }
  }, message);
  assert.equal(parseArnReport(restored, 'Astraeos').ok, true);
  assert.equal(String(message.content || ''), '');
});

test('live board setup logs one outcome and does not hang', async () => {
  const lines = [];
  const logger = {
    log(line) { lines.push(line); },
    warn(line) { lines.push(line); }
  };
  const ready = await runArnLiveBoardSetup({}, {
    logger,
    timeoutMs: 50,
    reconcile: async () => ({ publicChannelId: 'pub', intakeChannelId: 'in', replayed: 2, tracked: 1 })
  });
  assert.equal(ready.replayed, 2);
  assert.match(lines.at(-1), /ARN live board ready: publicChannel=pub intakeChannel=in replayed=2 tracked=1/);

  lines.length = 0;
  const skipped = await runArnLiveBoardSetup({}, {
    logger,
    timeoutMs: 50,
    reconcile: async () => ({ skipped: 'arn-intake-not-found' })
  });
  assert.equal(skipped.skipped, 'arn-intake-not-found');
  assert.match(lines.at(-1), /ARN live board skipped: arn-intake-not-found/);

  lines.length = 0;
  let finishHang;
  const hung = new Promise((resolve) => { finishHang = resolve; });
  const started = Date.now();
  const stalled = await runArnLiveBoardSetup({}, {
    logger,
    timeoutMs: 40,
    reconcile: () => hung
  });
  assert.equal(stalled.unavailable, 'setup-timeout');
  assert.match(lines.at(-1), /ARN live board unavailable: setup-timeout/);
  assert.ok(Date.now() - started < 1000);
  assert.equal(lines.length, 1);
  finishHang({ skipped: 'test-release' });
  await hung;
});

test('the live board hook is installed on the Client Sentinal logs in with', () => {
  const discord = require('discord.js');
  const Original = discord.Client;
  class SentinalClient extends Original {}
  const inherited = SentinalClient.prototype.login;
  SentinalClient.prototype.login = function clusterPlanLogin(...args) {
    return inherited.apply(this, args);
  };
  discord.Client = SentinalClient;
  try {
    delete SentinalClient.prototype[Symbol.for('khaos.nexus.arnLiveBoard.extension')];
    installArnLiveBoardExtension();
    assert.equal(SentinalClient.prototype.login.name, 'nexusArnLiveBoardLogin');
    assert.notEqual(Original.prototype.login.name, 'nexusArnLiveBoardLogin');
    assert.equal(SETUP_DELAY_MS, 105_000);
    const previous = discord.Client.prototype.login;
    discord.Client.prototype.login = function protocolLogin(...args) {
      return previous.apply(this, args);
    };
    assert.equal(discord.Client.prototype.login.name, 'protocolLogin');
    const wrapped = discord.Client.prototype.login;
    const source = Function.prototype.toString.call(wrapped);
    assert.match(source, /previous\.apply/);
  } finally {
    discord.Client = Original;
  }
});

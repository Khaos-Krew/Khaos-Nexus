'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { ChannelType } = require('discord.js');
const {
  RESOLVED_LINGER_MS,
  INFO_MARKER,
  BOARD_MARKER,
  parseShinyDiscordPayload,
  classifyThreat,
  applyEvent,
  sortedAnomalies,
  boardEmbed,
  rawMessagePayload,
  runArnLiveBoardSetup,
  replayIntake,
  armArnLiveBoard,
  ensurePublicChannel,
  ensurePanelMessages,
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
  assert.match(lines.at(-1), /ARN live board ready: publicChannel=pub intakeChannel=in tracked=1/);
  assert.doesNotMatch(lines.at(-1), /replayed=/);

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
  await new Promise((resolve) => setImmediate(resolve));
  assert.match(lines.at(-1), /ARN live board skipped: test-release/);

  lines.length = 0;
  let finishLate;
  let armed = 0;
  const late = new Promise((resolve) => { finishLate = resolve; });
  const timedOut = await runArnLiveBoardSetup({}, {
    logger,
    timeoutMs: 20,
    onReady() { armed += 1; },
    reconcile: () => late
  });
  assert.equal(timedOut.unavailable, 'setup-timeout');
  finishLate({ publicChannelId: 'late', intakeChannelId: 'in', replayed: 3, tracked: 2 });
  await late;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(armed, 1);
  assert.match(lines.at(-1), /ARN live board ready \(late\): publicChannel=late/);
});

test('a slow live-board step arms refresh when it finishes and names a step error', async () => {
  const lines = [];
  const logger = {
    log(line) { lines.push(line); },
    warn(line) { lines.push(line); }
  };
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let armed = 0;
  const timedOut = await runArnLiveBoardSetup({}, {
    logger,
    timeoutMs: 25,
    onReady() { armed += 1; },
    async reconcile(_client, hooks) {
      hooks.noteStep('replay');
      await gate;
      return { publicChannelId: 'late', intakeChannelId: 'in', replayed: 4, tracked: 1 };
    }
  });
  assert.equal(timedOut.step, 'replay');
  assert.match(lines.at(-1), /ARN live board unavailable: setup-timeout step=replay/);
  release();
  await gate;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(armed, 1);
  assert.match(lines.at(-1), /ARN live board ready \(late\): publicChannel=late intakeChannel=in tracked=1/);
  assert.doesNotMatch(lines.at(-1), /replayed=/);

  lines.length = 0;
  let failRelease;
  const failGate = new Promise((resolve) => { failRelease = resolve; });
  const failed = await runArnLiveBoardSetup({}, {
    logger,
    timeoutMs: 20,
    async reconcile(_client, hooks) {
      hooks.noteStep('panel');
      await failGate;
      const error = new Error('Bearer super-secret-token');
      error.status = 429;
      throw error;
    }
  });
  assert.equal(failed.unavailable, 'setup-timeout');
  assert.match(lines.at(-1), /setup-timeout step=panel/);
  failRelease();
  await failGate;
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const late = lines.at(-1);
  assert.match(late, /ARN live board unavailable \(late\): step=panel reason=rate-limited/);
  assert.equal(lines.some((line) => line.includes('super-secret-token')), false);
});

test('replay stops after two history pages', async () => {
  const fetches = [];
  const channel = {
    messages: {
      async fetch(query) {
        fetches.push(query);
        const start = 5000 - (fetches.length * 50);
        const batch = new Map();
        for (let index = 0; index < 50; index += 1) {
          const id = String(start - index);
          batch.set(id, { id, webhookId: '', createdTimestamp: index });
        }
        return batch;
      }
    }
  };
  const lines = [];
  const accepted = await replayIntake({}, channel, { logger: { log(line) { lines.push(line); } } });
  assert.equal(accepted, 0);
  assert.match(lines[0], /ARN live board replayed: count=0/);
  assert.equal(fetches.length, 2);
  assert.equal(fetches[0].limit, 50);
  assert.equal(fetches[0].before, undefined);
  assert.equal(fetches[1].before, '4901');
});

function panelEnv() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'arn-board-'));
  return { ARN_DRY_RUN_FILE: path.join(dir, 'arn-dry-run.json') };
}

test('panel setup reads one page and does not edit the other ARN service', async () => {
  const fetches = [];
  const edits = [];
  const sent = [];
  const channel = {
    async send(body) {
      sent.push(String(body.embeds[0].footer.text));
      return { id: `new-${sent.length}`, embeds: body.embeds, author: { id: 'sentinal-bot', bot: true } };
    },
    messages: {
      async fetch(query) {
        fetches.push(query);
        return new Map([
          ['foreign', {
            id: 'foreign',
            author: { id: 'arn-service', bot: true },
            embeds: [
              { footer: { text: INFO_MARKER } },
              { footer: { text: `${BOARD_MARKER} • Sentinel managed • Last refresh` } }
            ],
            async edit() { edits.push('foreign'); }
          }]
        ]);
      }
    }
  };
  const placed = await ensurePanelMessages(channel, 'sentinal-bot', { env: panelEnv() });
  assert.equal(fetches.length, 1);
  assert.deepEqual(fetches[0], { limit: 50 });
  assert.deepEqual(edits, []);
  assert.equal(sent.length, 2);
  assert.equal(placed.info.id, 'new-1');
  assert.equal(placed.board.id, 'new-2');
});

test('a second panel setup edits the stored messages instead of posting', async () => {
  const env = panelEnv();
  let sends = 0;
  const sent = new Map();
  const channel = {
    async send(body) {
      sends += 1;
      const message = {
        id: String(100 + sends),
        author: { id: 'sentinal-bot', bot: true },
        embeds: body.embeds,
        edits: 0,
        async edit() { this.edits += 1; return this; }
      };
      sent.set(message.id, message);
      return message;
    },
    messages: {
      async fetch(query) {
        if (typeof query === 'string') return sent.get(query);
        return new Map();
      }
    }
  };
  await ensurePanelMessages(channel, 'sentinal-bot', { env });
  const again = await ensurePanelMessages(channel, 'sentinal-bot', { env });
  assert.equal(sends, 2);
  assert.equal(again.info.edits, 1);
  assert.equal(again.board.edits, 1);
});

test('a stored board older than the recent page is edited by id', async () => {
  const env = panelEnv();
  const recordDir = path.dirname(env.ARN_DRY_RUN_FILE);
  fs.mkdirSync(recordDir, { recursive: true });
  fs.writeFileSync(path.join(recordDir, 'arn-live-board.json'), JSON.stringify({
    infoMessageId: '11',
    boardMessageId: '12'
  }));
  const queries = [];
  const edits = [];
  const recent = new Map();
  for (let index = 0; index < 50; index += 1) {
    recent.set(`new-${index}`, {
      id: `new-${index}`,
      author: { id: 'arn-service', bot: true },
      embeds: [{ footer: { text: 'other board' } }]
    });
  }
  const stored = {
    11: {
      id: '11',
      author: { id: 'sentinal-bot', bot: true },
      embeds: [{ footer: { text: INFO_MARKER } }],
      async edit() { edits.push('11'); return this; }
    },
    12: {
      id: '12',
      author: { id: 'sentinal-bot', bot: true },
      embeds: [{ footer: { text: `${BOARD_MARKER} • Sentinel managed • kept` } }],
      async edit() { edits.push('12'); return this; }
    }
  };
  let sends = 0;
  const channel = {
    async send() { sends += 1; return { id: 'posted' }; },
    messages: {
      async fetch(query) {
        queries.push(query);
        if (typeof query === 'string') return stored[query];
        return recent;
      }
    }
  };
  const placed = await ensurePanelMessages(channel, 'sentinal-bot', { env });
  assert.deepEqual(edits, ['11', '12']);
  assert.equal(sends, 0);
  assert.equal(placed.board.id, '12');
  assert.equal(queries.some((query) => query?.limit === 50), false);
});

test('concurrent setup posts one channel and one board', async () => {
  let creates = 0;
  const guild = {
    channels: {
      async create() {
        creates += 1;
        await new Promise((resolve) => setTimeout(resolve, 15));
        return { id: 'arn-channel', parentId: 'cat', name: 'arn' };
      }
    }
  };
  const channels = new Map([
    ['cat', { id: 'cat', type: ChannelType.GuildCategory, name: 'ARK' }]
  ]);
  const [first, second] = await Promise.all([
    ensurePublicChannel(guild, channels),
    ensurePublicChannel(guild, channels)
  ]);
  assert.equal(creates, 1);
  assert.equal(first.channel.id, 'arn-channel');
  assert.equal(second.channel.id, 'arn-channel');

  const env = panelEnv();
  let sends = 0;
  const channel = {
    async send(body) {
      sends += 1;
      await new Promise((resolve) => setTimeout(resolve, 15));
      return {
        id: String(sends),
        author: { id: 'sentinal-bot', bot: true },
        embeds: body.embeds,
        async edit() { return this; }
      };
    },
    messages: { async fetch() { return new Map(); } }
  };
  const [panelA, panelB] = await Promise.all([
    ensurePanelMessages(channel, 'sentinal-bot', { env }),
    ensurePanelMessages(channel, 'sentinal-bot', { env })
  ]);
  assert.equal(sends, 2);
  assert.equal(panelA.board.id, panelB.board.id);
});

test('a timed-out setup retries with backoff and late success cancels the retry', async () => {
  const lines = [];
  const logger = {
    log(line) { lines.push(line); },
    warn(line) { lines.push(line); }
  };
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let armed = 0;
  armArnLiveBoard({}, {
    delayMs: 0,
    timeoutMs: 20,
    retryDelays: [50],
    logger,
    onReady() { armed += 1; },
    async reconcile(_client, hooks) {
      calls += 1;
      hooks.noteStep('guild-fetch');
      await gate;
      return { publicChannelId: 'p', intakeChannelId: 'i', replayed: 0, tracked: 0 };
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(calls, 1);
  assert.match(lines.join('\n'), /setup-timeout step=guild-fetch/);
  assert.match(lines.join('\n'), /ARN live board retry: attempt=1 waitMs=50/);
  release();
  await gate;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(armed, 1);
  assert.match(lines.join('\n'), /ARN live board ready \(late\):/);
  await new Promise((resolve) => setTimeout(resolve, 70));
  assert.equal(calls, 1);
  assert.equal(armed, 1);
});

test('an overlapping retry waits and does not post a second board', async () => {
  const lines = [];
  const logger = {
    log(line) { lines.push(line); },
    warn(line) { lines.push(line); }
  };
  let calls = 0;
  let posts = 0;
  armArnLiveBoard({}, {
    delayMs: 0,
    timeoutMs: 15,
    retryDelays: [20],
    logger,
    async reconcile() {
      calls += 1;
      posts += 1;
      await new Promise(() => {});
    }
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(calls, 1);
  assert.equal(posts, 1);
  assert.match(lines.join('\n'), /ARN live board retry: attempt=1 waitMs=20 pending/);
});

test('a failed REST read logs once and keeps the gateway payload', async () => {
  const warnings = [];
  const original = console.warn;
  console.warn = (line) => warnings.push(String(line));
  try {
    const payload = await rawMessagePayload({
      rest: { async get() { throw new Error('boom\nsecret'); } }
    }, { channelId: '1', id: '2', content: 'plain', embeds: [] });
    assert.equal(payload.content, 'plain');
    assert.equal(warnings.length, 1);
    assert.match(warnings[0], /ARN message read failed; using gateway payload: boom secret/);
    assert.equal(warnings[0].includes('\n'), false);
  } finally {
    console.warn = original;
  }
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

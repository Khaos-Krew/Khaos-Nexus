'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ChannelType } = require('discord.js');
const {
  STATUS_PANEL_MARKER,
  STATUS_PANEL_TITLE,
  normalizeChannelName,
  findInformationCategory,
  findNexusStatusChannel,
  healthUrl,
  normalizeProbeState,
  aggregateState,
  renderNexusStatusPanel,
  reconcileStatusPanel,
  ensureNexusStatusChannel
} = require('../src/sentinel/nexus-status.cjs');
const { buildNexusStatusSnapshot } = require('../src/sentinel/nexus-status-extension.cjs');

function textChannel(id, name, parentId = '') {
  return {
    id,
    name,
    parentId,
    type: ChannelType.GuildText,
    isTextBased: () => true
  };
}

function category(id, name) {
  return { id, name, type: ChannelType.GuildCategory };
}

function fakeMessage(id, createdTimestamp, authorId = 'sentinal') {
  const state = { edits: 0, deletes: 0, pins: 0, payload: null };
  return {
    id,
    createdTimestamp,
    author: { id: authorId, bot: true },
    pinned: false,
    embeds: [{ title: STATUS_PANEL_TITLE, footer: { text: STATUS_PANEL_MARKER } }],
    edit: async (payload) => { state.edits += 1; state.payload = payload; },
    delete: async () => { state.deletes += 1; },
    pin: async () => { state.pins += 1; },
    state
  };
}

test('Nexus Status discovery recognizes the INFORMATION category and nexus-status channel', () => {
  assert.equal(normalizeChannelName('ℹ️ INFORMATION'), 'information');
  const info = category('cat-info', 'ℹ️ INFORMATION');
  const status = textChannel('status', 'nexus-status', info.id);
  const channels = new Map([[info.id, info], [status.id, status]]);
  assert.equal(findInformationCategory(channels)?.id, info.id);
  assert.equal(findNexusStatusChannel(channels, info.id)?.id, status.id);
});

test('missing Nexus Status channel is created under INFORMATION', async () => {
  const info = category('cat-info', 'INFORMATION');
  let createOptions = null;
  const created = textChannel('status-new', 'nexus-status', info.id);
  const guild = {
    channels: {
      fetch: async (id) => id ? null : new Map([[info.id, info]]),
      create: async (options) => { createOptions = options; return created; }
    }
  };
  const result = await ensureNexusStatusChannel(guild, { discord: { nexusStatus: {} } });
  assert.equal(result.created, true);
  assert.equal(result.channel.id, created.id);
  assert.equal(createOptions.parent, info.id);
  assert.equal(createOptions.name, 'nexus-status');
});

test('health URLs normalize to /health and probe states fail closed', () => {
  assert.equal(healthUrl('https://example.test'), 'https://example.test/health');
  assert.equal(healthUrl('https://example.test/health'), 'https://example.test/health');
  assert.equal(normalizeProbeState({ ok: true, statusCode: 200, payload: { status: 'ok' } }).state, 'online');
  assert.equal(normalizeProbeState({ ok: true, statusCode: 200, payload: { status: 'warming' } }).state, 'degraded');
  assert.equal(normalizeProbeState({ ok: false, statusCode: 503, payload: { status: 'degraded' } }).state, 'offline');
  assert.equal(aggregateState([{ state: 'online' }, { state: 'online' }]), 'online');
  assert.equal(aggregateState([{ state: 'online' }, { state: 'offline' }]), 'degraded');
  assert.equal(aggregateState([{ state: 'offline' }, { state: 'offline' }]), 'offline');
});

test('rendered Nexus Status panel shows both Sentinal and Veyra service health', () => {
  const payload = renderNexusStatusPanel({
    checkedAt: '2026-08-24T21:50:00.000Z',
    sentinal: {
      state: 'online',
      discord: { state: 'online', label: 'Connected', uptimeSec: 120 },
      backend: { state: 'online', label: 'Healthy' }
    },
    veyra: {
      state: 'online',
      lore: { state: 'online', label: 'Healthy' },
      gateway: { state: 'online', label: 'Healthy', uptimeSec: 240 }
    }
  });
  const embed = payload.embeds[0];
  assert.equal(embed.title, STATUS_PANEL_TITLE);
  assert.equal(embed.footer.text, STATUS_PANEL_MARKER);
  assert.match(embed.fields[0].name, /Nexus Sentinal/);
  assert.match(embed.fields[1].name, /Veyra — Lore Master/);
  assert.match(embed.fields[0].value, /Discord Gateway: \*\*Connected\*\*/);
  assert.match(embed.fields[1].value, /Lore Master API: \*\*Healthy\*\*/);
});

test('Nexus Status reconciliation reuses newest panel, removes duplicates, and pins canonical message', async () => {
  const old = fakeMessage('1', 100);
  const current = fakeMessage('2', 200);
  const otherBot = fakeMessage('3', 300, 'other');
  const channel = {
    client: { user: { id: 'sentinal' } },
    messages: { fetch: async () => new Map([[old.id, old], [current.id, current], [otherBot.id, otherBot]]) }
  };
  const payload = renderNexusStatusPanel({
    sentinal: { state: 'online', discord: { state: 'online', label: 'Connected' }, backend: { state: 'online', label: 'Healthy' } },
    veyra: { state: 'degraded', lore: { state: 'online', label: 'Healthy' }, gateway: { state: 'offline', label: 'Offline' } }
  });
  const result = await reconcileStatusPanel(channel, payload, { botId: 'sentinal' });
  assert.equal(result.message.id, current.id);
  assert.equal(result.duplicatesRemoved, 1);
  assert.equal(current.state.edits, 1);
  assert.equal(current.state.pins, 1);
  assert.equal(old.state.deletes, 1);
  assert.equal(otherBot.state.deletes, 0);
});

test('status snapshot reports Sentinal and Veyra from independent component probes', async () => {
  const probes = new Map([
    ['http://127.0.0.1:3210', { state: 'online', label: 'Healthy' }],
    ['https://veyra.example/health', { state: 'online', label: 'Healthy' }],
    ['https://veyra-gateway.example/health', { state: 'online', label: 'Healthy' }]
  ]);
  const snapshot = await buildNexusStatusSnapshot(
    { isReady: () => true, uptime: 5000 },
    {
      backend: { publicBaseUrl: 'http://127.0.0.1:3210' },
      discord: { nexusStatus: { veyraHealthUrl: 'https://veyra.example/health', veyraGatewayHealthUrl: 'https://veyra-gateway.example/health' } }
    },
    { probeHealth: async (url) => probes.get(url) || { state: 'offline', label: 'Offline' } }
  );
  assert.equal(snapshot.sentinal.state, 'online');
  assert.equal(snapshot.veyra.state, 'online');
});

test('Sentinal entry installs the Nexus Status extension', () => {
  const entry = fs.readFileSync(path.resolve(__dirname, '../src/sentinel/entry.cjs'), 'utf8');
  assert.match(entry, /installNexusStatusExtension/);
  assert.match(entry, /installNexusStatusExtension\(\)/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DiscordShadowAdapter,
  normalizeGuildSnapshot,
  snapshotFingerprint,
  diffGuildSnapshots,
} = require('../src/sentinel-v2/discord-shadow-adapter.cjs');

function fixture() {
  const guild = {
    id: 'guild-1',
    name: 'Khaos Nexus',
    memberCount: 42,
  };
  const channels = new Map([
    ['c2', { id: 'c2', name: 'general', type: 0, parentId: 'cat-1', rawPosition: 2 }],
    ['c1', { id: 'c1', name: 'welcome', type: 0, parentId: 'cat-1', rawPosition: 1 }],
  ]);
  const roles = new Map([
    ['r2', { id: 'r2', name: 'Admin', position: 2, managed: false }],
    ['r1', { id: 'r1', name: 'Member', position: 1, managed: false }],
  ]);
  return { guild, channels, roles };
}

test('normalizes Discord guild state into a stable read-only snapshot', () => {
  const snapshot = normalizeGuildSnapshot(fixture());
  assert.equal(snapshot.guildId, 'guild-1');
  assert.equal(snapshot.memberCount, 42);
  assert.equal(snapshot.channelCount, 2);
  assert.equal(snapshot.roleCount, 2);
  assert.deepEqual(snapshot.channels.map((item) => item.id), ['c1', 'c2']);
  assert.deepEqual(snapshot.roles.map((item) => item.id), ['r1', 'r2']);
});

test('snapshot fingerprint is stable for equivalent guild state', () => {
  const first = normalizeGuildSnapshot(fixture());
  const second = normalizeGuildSnapshot(fixture());
  assert.equal(snapshotFingerprint(first), snapshotFingerprint(second));
});

test('snapshot diff reports no drift for equal fingerprints and drift after a change', () => {
  const base = normalizeGuildSnapshot(fixture());
  const first = { ...base, fingerprint: snapshotFingerprint(base) };
  const same = { ...base, fingerprint: snapshotFingerprint(base) };
  assert.deepEqual(diffGuildSnapshots(first, same), {
    changed: false,
    reason: 'no-drift',
    previousFingerprint: first.fingerprint,
    currentFingerprint: same.fingerprint,
  });

  const changedBase = { ...base, guildName: 'Khaos Nexus Updated' };
  const changed = { ...changedBase, fingerprint: snapshotFingerprint(changedBase) };
  const diff = diffGuildSnapshots(first, changed);
  assert.equal(diff.changed, true);
  assert.equal(diff.reason, 'guild-drift');
});

test('Discord shadow adapter fetches state without requiring mutation methods', async () => {
  const { guild, channels, roles } = fixture();
  const fetchedGuild = {
    ...guild,
    channels: { async fetch() { return channels; } },
    roles: { async fetch() { return roles; } },
  };
  const client = {
    guilds: { async fetch(id) { assert.equal(id, 'guild-1'); return fetchedGuild; } },
  };
  const adapter = new DiscordShadowAdapter({ guildId: 'guild-1', client });
  const snapshot = await adapter.snapshot();

  assert.equal(snapshot.guildId, 'guild-1');
  assert.equal(snapshot.channelCount, 2);
  assert.equal(snapshot.roleCount, 2);
  assert.match(snapshot.fingerprint, /^[a-f0-9]{64}$/);
});

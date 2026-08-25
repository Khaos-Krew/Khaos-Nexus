'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { JsonStore } = require('../src/backend/core/json-store.cjs');
const {
  parseCollection,
  parseLfg,
  extractOfficialNews,
  OnceHumanProvider
} = require('../src/backend/providers/once-human-provider.cjs');

function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-once-human-'));
  return { dir, store: new JsonStore(path.join(dir, 'state.json'), { users: {}, lfg: [] }) };
}

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async text() { return String(body); }
  };
}

test('Once Human local collection and LFG commands stay compact and deterministic', () => {
  assert.deepEqual(parseCollection('list'), { op: 'list', value: '' });
  assert.deepEqual(parseCollection('add Shrapnel build'), { op: 'add', value: 'Shrapnel build' });
  assert.deepEqual(parseCollection('remove Shrapnel build'), { op: 'remove', value: 'Shrapnel build' });
  assert.deepEqual(parseLfg('join LEA Research Lab'), { op: 'join', activity: 'LEA Research Lab' });
  assert.deepEqual(parseLfg('leave'), { op: 'leave', activity: '' });
});

test('official Once Human news parser only adopts public update/dev-blog links', () => {
  const html = `
    <a href="/news/update/20260714/40780_1307619.html"><span>3.0.1 Bug Fixes</span></a>
    <a href="https://www.oncehuman.game/news/devBlog/20250603/40781_1237869.html">Custom Server Preview</a>
    <a href="/private/player/profile">Private profile</a>
  `;
  const items = extractOfficialNews(html);
  assert.equal(items.length, 2);
  assert.match(items[0].url, /oncehuman\.game\/news\/update/);
  assert.match(items[1].url, /oncehuman\.game\/news\/devBlog/);
  assert.doesNotMatch(JSON.stringify(items), /private\/player/);
});

test('Once Human provider persists per-user builds and wishlist without claiming live player data', async () => {
  const holder = tempStore();
  try {
    const provider = new OnceHumanProvider({ store: holder.store, fetchImpl: async () => response(500, '') });
    const context = { actorId: '100000000000000001' };
    await provider.invoke('builds', { input: 'add Shrapnel + crit build' }, context);
    await provider.invoke('wishlist', { input: 'add AWS.338 Bingo blueprint' }, context);
    const builds = await provider.invoke('builds', { input: 'list' }, context);
    const wishlist = await provider.invoke('wishlist', { input: 'list' }, context);
    assert.deepEqual(builds.items, ['Shrapnel + crit build']);
    assert.deepEqual(wishlist.items, ['AWS.338 Bingo blueprint']);
    const status = await provider.invoke('api-status', {}, context);
    assert.equal(status.officialPublicPlayerApi, false);
    assert.equal(status.undocumentedEndpointScraping, false);
  } finally {
    fs.rmSync(holder.dir, { recursive: true, force: true });
  }
});

test('Once Human LFG entries expire and replace a user previous listing', async () => {
  const holder = tempStore();
  try {
    const provider = new OnceHumanProvider({ store: holder.store, fetchImpl: async () => response(500, '') });
    const context = { actorId: '100000000000000001' };
    await provider.invoke('lfg', { input: 'join Prime War' }, context);
    const second = await provider.invoke('lfg', { input: 'join LEA Research Lab' }, context);
    assert.equal(second.entries.length, 1);
    assert.equal(second.entries[0].activity, 'LEA Research Lab');
    const left = await provider.invoke('lfg', { input: 'leave' }, context);
    assert.equal(left.entries.length, 0);
  } finally {
    fs.rmSync(holder.dir, { recursive: true, force: true });
  }
});

test('official news failures degrade to the official hub instead of breaking the module', async () => {
  const holder = tempStore();
  try {
    const provider = new OnceHumanProvider({ store: holder.store, fetchImpl: async () => response(503, '') });
    const result = await provider.invoke('news');
    assert.equal(result.degraded, true);
    assert.match(result.url, /oncehuman\.game\/news/);
    assert.match(result.note, /503/);
  } finally {
    fs.rmSync(holder.dir, { recursive: true, force: true });
  }
});

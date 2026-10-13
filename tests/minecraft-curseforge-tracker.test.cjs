'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const t = require('../src/sentinel/minecraft-curseforge-tracker.cjs');

const MOD = { id: 1742187, gameId: 432, name: 'Khaos Nexus', slug: 'khaos-nexus', links: { websiteUrl: 'https://www.curseforge.com/minecraft/mc-mods/khaos-nexus' }, logo: { thumbnailUrl: 'https://media.forgecdn.net/logo.png' } };
const file = (id, extra = {}) => ({ id, displayName: `Khaos Nexus 0.0.${id}`, fileName: `khaosnexus-${id}.jar`, releaseType: 3, gameVersions: ['1.21.1', 'NeoForge', 'Client', 'Server'], fileDate: `2026-10-1${id % 10}T00:00:00Z`, ...extra });
const config = (extra = {}) => ({ ...t.trackerConfig({ CURSEFORGE_API_KEY: 'k', CURSEFORGE_TRACKED_PROJECTS: '1742187', CURSEFORGE_TRACKER_CHANNEL_ID: '1559388431677792307' }), ...extra });
const quiet = { log() {}, warn() {} };

function fakeApi({ mod = MOD, files = [], modError, filesError } = {}) {
  return {
    async getMod() { if (modError) throw modError; return mod; },
    async findBySlug(slug) { return mod && mod.slug === slug ? mod : null; },
    async getFiles() { if (filesError) throw filesError; return files; },
    async getChangelog() { return '<p>Added <b>gates</b></p><ul><li>New mobs</li></ul>'; }
  };
}

test('config is disabled cleanly when env is missing', () => {
  const c = t.trackerConfig({});
  assert.equal(c.enabled, false);
  assert.deepEqual(c.missing, ['CURSEFORGE_API_KEY', 'CURSEFORGE_TRACKED_PROJECTS', 'CURSEFORGE_TRACKER_CHANNEL_ID']);
  assert.equal(config().enabled, true);
  assert.equal(config().intervalMinutes, 15);
  assert.equal(t.trackerConfig({ CURSEFORGE_TRACKER_INTERVAL_MINUTES: '1' }).intervalMinutes, 5);
});

test('parses numeric ids with slug fallback and dedupes', () => {
  assert.deepEqual(t.parseTrackedProjects('1742187, khaos-nexus 1742187,KHAOS-NEXUS'), [{ id: 1742187 }, { slug: 'khaos-nexus' }]);
});

test('state path lives under NEXUS_DATA_DIR and round-trips', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cft-'));
  const f = t.stateFilePath({ NEXUS_DATA_DIR: dir });
  assert.equal(f, path.join(dir, 'minecraft-curseforge-tracker.json'));
  assert.deepEqual(t.loadState(f), { version: 1, projects: {} });
  t.saveState(f, { version: 1, projects: { 1: { seeded: true, postedFileIds: [5] } } });
  assert.deepEqual(t.loadState(f).projects['1'].postedFileIds, [5]);
});

test('first run seeds existing files without posting, then posts only new files', async () => {
  const state = { version: 1, projects: {} };
  const posts = [];
  const post = async (p) => posts.push(p);
  let s = await t.pollOnce({ config: config(), api: fakeApi({ files: [file(1), file(2)] }), state, post, log: quiet });
  assert.equal(posts.length, 0);
  assert.equal(s.seeded, 2);
  s = await t.pollOnce({ config: config(), api: fakeApi({ files: [file(1), file(2)] }), state, post, log: quiet });
  assert.equal(posts.length, 0);
  s = await t.pollOnce({ config: config(), api: fakeApi({ files: [file(3), file(1), file(2)] }), state, post, log: quiet });
  assert.equal(s.posted, 1);
  assert.equal(posts.length, 1);
  assert.match(posts[0].embeds[0].title, /0\.0\.3/);
});

test('pending moderation (404 / empty) is quiet, and the first approved file is announced', async () => {
  const state = { version: 1, projects: {} };
  const posts = [];
  const post = async (p) => posts.push(p);
  const notFound = Object.assign(new Error('404'), { status: 404 });
  let s = await t.pollOnce({ config: config(), api: fakeApi({ modError: notFound }), state, post, log: quiet });
  assert.deepEqual(s, { posted: 0, seeded: 0, pending: 1, errors: 0 });
  s = await t.pollOnce({ config: config(), api: fakeApi({ files: [] }), state, post, log: quiet });
  assert.equal(s.errors, 0);
  s = await t.pollOnce({ config: config(), api: fakeApi({ files: [file(1)] }), state, post, log: quiet });
  assert.equal(s.posted, 1);
});

test('non-404 errors are counted, not thrown, and nothing is marked posted', async () => {
  const state = { version: 1, projects: { 1742187: { seeded: true, postedFileIds: [] } } };
  const s = await t.pollOnce({ config: config(), api: fakeApi({ filesError: Object.assign(new Error('boom'), { status: 500 }) }), state, post: async () => {}, log: quiet });
  assert.equal(s.errors, 1);
  assert.deepEqual(state.projects['1742187'].postedFileIds, []);
});

test('embed has project, file, release type, versions, loader, changelog excerpt and <download link>', () => {
  const e = t.buildFileEmbed(MOD, file(1), '<p>Added <b>gates</b></p><ul><li>New mobs</li></ul>');
  assert.equal(e.title, 'Khaos Nexus: Khaos Nexus 0.0.1');
  assert.equal(e.thumbnail.url, MOD.logo.thumbnailUrl);
  const f = Object.fromEntries(e.fields.map((x) => [x.name, x.value]));
  assert.equal(f['Release type'], 'Alpha');
  assert.equal(f.Minecraft, '1.21.1');
  assert.equal(f.Loader, 'NeoForge');
  assert.match(f.Changelog, /Added gates/);
  assert.match(f.Changelog, /• New mobs/);
  assert.equal(f.Download, '<https://www.curseforge.com/minecraft/mc-mods/khaos-nexus/files/1>');
  assert.equal(e.url, 'https://www.curseforge.com/minecraft/mc-mods/khaos-nexus/files/1');
});

test('changelog excerpt truncates', () => {
  assert.equal(t.changelogExcerpt(`<p>${'a'.repeat(1000)}</p>`).length, 400);
  assert.equal(t.changelogExcerpt(''), '');
});

test('createApi sends x-api-key and maps 404 to status', async () => {
  const calls = [];
  const api = t.createApi({ apiKey: 'secret', fetchImpl: async (url, opts) => { calls.push({ url, opts }); return { ok: false, status: 404 }; } });
  await assert.rejects(api.getFiles(1742187), (e) => e.status === 404);
  assert.match(calls[0].url, /\/v1\/mods\/1742187\/files/);
  assert.equal(calls[0].opts.headers['x-api-key'], 'secret');
});

test('install is a clean no-op when disabled', () => {
  class FakeClient { login() {} }
  const ok = t.installMinecraftCurseForgeTracker({ env: {}, Client: FakeClient, Events: {} });
  assert.equal(ok, false);
});

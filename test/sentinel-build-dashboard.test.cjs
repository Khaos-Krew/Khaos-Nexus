'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  TEST_REACTION_PASS,
  TEST_REACTION_FAIL,
  buildVerdict,
  dashboardPayload,
  SentinelBuildDashboardService
} = require('../main/services/sentinel-build-dashboard-service.cjs');
const { CATEGORY_NAME, CHANNEL_NAME } = require('../main/services/sentinel-build-feed-service.cjs');

function tempDirectory() { return fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-sentinel-dashboard-')); }
function configStore() {
  return {
    getRuntimeBootstrap() { return { discordToken: 'discord-token', config: { discord: { guildId: '123456789012345678' } } }; },
    getGithubToken() { return 'github-token'; }
  };
}
function response(payload, status = 200) { return { ok: status >= 200 && status < 300, status, async json() { return payload; } }; }
function runs(phase = 0) {
  const version = phase ? '0.41.3' : '0.41.2';
  const sha = phase ? 'def456def456def456' : 'abc123abc123abc123';
  const base = phase ? 201 : 101;
  return [
    { id: base, name: 'Windows Build', head_branch: `owner-test/dashboard-v${version}`, head_sha: sha, status: 'completed', conclusion: 'success', html_url: `https://github.com/Khaos-Krew/Khaos-Nexus/actions/runs/${base}`, created_at: phase ? '2026-08-20T23:15:00.000Z' : '2026-08-20T22:30:00.000Z', updated_at: phase ? '2026-08-20T23:20:00.000Z' : '2026-08-20T22:40:00.000Z' },
    { id: base + 1, name: 'Android Owner Test', head_branch: `owner-test/dashboard-v${version}`, head_sha: sha, status: 'completed', conclusion: 'success', html_url: `https://github.com/Khaos-Krew/Khaos-Nexus/actions/runs/${base + 1}`, created_at: phase ? '2026-08-20T23:16:00.000Z' : '2026-08-20T22:31:00.000Z', updated_at: phase ? '2026-08-20T23:21:00.000Z' : '2026-08-20T22:41:00.000Z' }
  ];
}

test('verdict ignores Sentinel seed reactions and resolves human votes', () => {
  const verdict = buildVerdict(
    [{ id: '1', username: 'Sentinel', bot: true }, { id: '2', username: 'Kirito', bot: false }],
    [{ id: '1', username: 'Sentinel', bot: true }]
  );
  assert.equal(verdict.status, 'working');
  assert.deepEqual(verdict.pass.map((user) => user.id), ['2']);
});

test('dashboard payload adds reaction verdict and streamlined live-card wording', () => {
  const payload = dashboardPayload(
    { sha: 'abcdef1234567890', branch: 'owner-test/dashboard-v0.41.2', runs: [{ name: 'Windows Build' }], runUrl: 'https://github.com/Khaos-Krew/Khaos-Nexus/actions/runs/123', updatedAt: '2026-08-20T23:00:00.000Z' },
    [{ id: 1001, runId: 123, name: 'Khaos-Nexus-Windows-0.41.2-B' }]
  );
  const text = JSON.stringify(payload);
  assert.match(text, /one live owner-testing card/i);
  assert.match(text, /Tester verdict/);
  assert.match(text, /React ✅ for working or ❌ for failed/);
});

test('dashboard keeps one live test message while verdicts and candidates change', async () => {
  const category = { id: '70001', name: CATEGORY_NAME, type: 4, parent_id: null };
  const channel = { id: '70002', name: CHANNEL_NAME, type: 0, parent_id: '70001' };
  const posts = [];
  const patches = [];
  const puts = [];
  const deletes = [];
  let passUsers = [];
  let failUsers = [];
  const rest = {
    async get(route) {
      if (route === '/guilds/123456789012345678/channels') return [category, channel];
      if (route.endsWith(`/reactions/${encodeURIComponent(TEST_REACTION_PASS)}`)) return passUsers;
      if (route.endsWith(`/reactions/${encodeURIComponent(TEST_REACTION_FAIL)}`)) return failUsers;
      throw new Error(`Unexpected GET ${route}`);
    },
    async post(route, { body }) { posts.push({ route, body }); return { id: String(80000 + posts.length) }; },
    async patch(route, { body }) { patches.push({ route, body }); return { id: route.split('/').pop(), ...body }; },
    async put(route) { puts.push(route); return null; },
    async delete(route) { deletes.push(route); if (route.endsWith('/reactions')) { passUsers = []; failUsers = []; } return null; }
  };
  let buildPhase = 0;
  let releasePhase = 0;
  const fetchImpl = async (url) => {
    const currentRuns = runs(buildPhase);
    if (url.includes('/actions/runs?')) return response({ workflow_runs: currentRuns });
    for (const run of currentRuns) {
      if (url.includes(`/actions/runs/${run.id}/artifacts`)) {
        const version = buildPhase ? '0.41.3' : '0.41.2';
        const mobile = /Android/.test(run.name);
        return response({ artifacts: [{ id: run.id + 1000, name: mobile ? `Khaos-Nexus-Mobile-Android-${version}-B` : `Khaos-Nexus-Windows-${version}-B`, expired: false }] });
      }
    }
    if (url.includes('/releases?')) {
      const list = [{ id: 301, tag_name: 'v0.41.1-B', prerelease: true, draft: false, published_at: '2026-08-19T20:00:00.000Z', html_url: 'https://github.com/Khaos-Krew/Khaos-Nexus/releases/tag/v0.41.1-B', assets: [] }];
      if (releasePhase) list.unshift({ id: 302, tag_name: 'v0.41.2-B', prerelease: true, draft: false, published_at: '2026-08-20T23:05:00.000Z', html_url: 'https://github.com/Khaos-Krew/Khaos-Nexus/releases/tag/v0.41.2-B', assets: [] });
      return response(list);
    }
    throw new Error(`Unexpected GitHub URL ${url}`);
  };
  const service = new SentinelBuildDashboardService({ configStore: configStore(), dataDirectory: tempDirectory(), restFactory: () => rest, fetchImpl, now: () => new Date('2026-08-20T23:30:00.000Z') });

  await service.poll();
  assert.equal(posts.length, 1);
  assert.equal(puts.length, 2);
  const liveId = service.getDashboardState().messageId;
  assert.equal(liveId, '80001');

  await service.poll();
  assert.equal(posts.length, 1, 'unchanged poll does not create a duplicate');
  assert.equal(patches.length, 0, 'unchanged pending result does not edit needlessly');

  passUsers = [{ id: '555555555555555555', username: 'Kirito', bot: false }];
  await service.poll();
  assert.equal(posts.length, 1);
  assert.equal(patches.length, 1);
  assert.match(patches[0].body.embeds[0].title, /Working/);
  assert.equal(service.getDashboardState().messageId, liveId);

  buildPhase = 1;
  await service.poll();
  assert.equal(posts.length, 1, 'new candidate replaces the live test card in place');
  assert.equal(patches.length, 2);
  assert.ok(deletes.some((route) => route.endsWith('/reactions')));
  assert.equal(puts.length, 4);
  assert.match(patches[1].body.embeds[0].title, /0\.41\.3/);
  assert.equal(service.getDashboardState().messageId, liveId);

  releasePhase = 1;
  await service.poll();
  assert.equal(posts.length, 2, 'new beta/release remains a distinct announcement');
  assert.match(posts[1].body.embeds[0].title, /New Beta/);
});

test('production extension selects the streamlined dashboard service', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'main', 'sentinel-build-feed-extension.cjs'), 'utf8');
  assert.match(source, /SentinelBuildDashboardService/);
  assert.match(source, /live build testing dashboard/);
});

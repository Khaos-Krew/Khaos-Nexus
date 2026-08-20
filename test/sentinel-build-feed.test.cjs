'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  CATEGORY_NAME,
  CHANNEL_NAME,
  isManualTestWorkflow,
  artifactLooksTestable,
  artifactDownloadUrl,
  testChecklist,
  buildTestPayload,
  releaseKind,
  releasePayload,
  SentinelBuildFeedService
} = require('../main/services/sentinel-build-feed-service.cjs');

function tempDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'khaos-sentinel-build-feed-'));
}

function configStore() {
  return {
    getRuntimeBootstrap() {
      return { discordToken: 'discord-token', config: { discord: { guildId: '123456789012345678' } } };
    },
    getGithubToken() { return 'github-token'; }
  };
}

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return payload; }
  };
}

test('manual test workflow detection is restricted to build workflows and owner-test style branches', () => {
  assert.equal(isManualTestWorkflow({ name: 'Windows Build', head_branch: 'owner-test/android-resume-v0.41.2' }), true);
  assert.equal(isManualTestWorkflow({ name: 'Android Owner Test', head_branch: 'feature/mobile' }), true);
  assert.equal(isManualTestWorkflow({ name: 'Windows Build', head_branch: 'main' }), false);
  assert.equal(isManualTestWorkflow({ name: 'CI', head_branch: 'owner-test/mobile' }), false);
});

test('testable artifacts include product packages but exclude diagnostics and failed-test evidence', () => {
  assert.equal(artifactLooksTestable({ name: 'Khaos-Nexus-Windows', expired: false }), true);
  assert.equal(artifactLooksTestable({ name: 'Khaos-Nexus-Mobile-Android-0.41.2-B-owner-test', expired: false }), true);
  assert.equal(artifactLooksTestable({ name: 'windows-test-output', expired: false }), false);
  assert.equal(artifactLooksTestable({ name: 'Khaos-Nexus-Windows', expired: true }), false);
});

test('artifact links resolve to the exact trusted GitHub workflow artifact', () => {
  assert.equal(
    artifactDownloadUrl(32426983285, 9427765576),
    'https://github.com/Khaos-Krew/Khaos-Nexus/actions/runs/32426983285/artifacts/9427765576'
  );
});

test('test payload includes downloads, commit identity, checklist, and mention-safe delivery', () => {
  const group = {
    sha: 'abcdef1234567890',
    branch: 'owner-test/android-resume-v0.41.2',
    runs: [{ name: 'Windows Build' }, { name: 'Android Owner Test' }],
    runUrl: 'https://github.com/Khaos-Krew/Khaos-Nexus/actions/runs/123',
    updatedAt: '2026-08-20T23:00:00.000Z'
  };
  const artifacts = [
    { id: 1001, runId: 123, name: 'Khaos-Nexus-Windows' },
    { id: 1002, runId: 124, name: 'Khaos-Nexus-Mobile-Android-0.41.2-B-owner-test' }
  ];
  const payload = buildTestPayload(group, artifacts);
  const text = JSON.stringify(payload);
  assert.match(text, /Testing Needed/);
  assert.match(text, /What to test/);
  assert.match(text, /actions\/runs\/123\/artifacts\/1001/);
  assert.match(text, /actions\/runs\/124\/artifacts\/1002/);
  assert.match(text, /abcdef123456/);
  assert.match(text, /Mobile Gateway handshake/);
  assert.deepEqual(payload.allowed_mentions, { parse: [] });
});

test('release payload distinguishes beta from stable publication', () => {
  assert.equal(releaseKind({ tag_name: 'v0.41.2-B', prerelease: true }), 'beta');
  assert.equal(releaseKind({ tag_name: 'v0.42.0', prerelease: false }), 'release');
  const beta = releasePayload({
    id: 8,
    tag_name: 'v0.41.2-B',
    prerelease: true,
    html_url: 'https://github.com/Khaos-Krew/Khaos-Nexus/releases/tag/v0.41.2-B',
    assets: [{ name: 'Khaos-Nexus-Setup.exe', browser_download_url: 'https://github.com/Khaos-Krew/Khaos-Nexus/releases/download/v0.41.2-B/Khaos-Nexus-Setup.exe' }]
  });
  assert.match(beta.embeds[0].title, /New Beta/);
  assert.deepEqual(beta.allowed_mentions, { parse: [] });
});

test('service creates KHAOS NEXUS and nexus-builds additively when missing', async () => {
  const calls = [];
  const rest = {
    async get() { return []; },
    async post(route, { body }) {
      calls.push({ route, body });
      return { id: String(90000 + calls.length), ...body };
    }
  };
  const service = new SentinelBuildFeedService({
    configStore: configStore(),
    dataDirectory: tempDirectory(),
    restFactory: () => rest,
    fetchImpl: async () => response({}),
    now: () => new Date('2026-08-20T23:00:00.000Z')
  });
  const result = await service.ensureChannel();
  assert.equal(result.ready, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].body.name, CATEGORY_NAME);
  assert.equal(calls[0].body.type, 4);
  assert.equal(calls[1].body.name, CHANNEL_NAME);
  assert.equal(calls[1].body.type, 0);
  assert.equal(calls[1].body.parent_id, '90001');
});

test('service posts one matched test package, suppresses duplicates, then announces a new beta', async () => {
  const messages = [];
  const category = { id: '70001', name: CATEGORY_NAME, type: 4, parent_id: null };
  const channel = { id: '70002', name: CHANNEL_NAME, type: 0, parent_id: '70001' };
  const rest = {
    async get() { return [category, channel]; },
    async post(route, { body }) {
      messages.push({ route, body });
      return { id: String(80000 + messages.length) };
    }
  };

  let releasePhase = 0;
  const runs = [
    {
      id: 101,
      name: 'Windows Build',
      head_branch: 'owner-test/android-resume-v0.41.2',
      head_sha: 'abc123abc123abc123',
      status: 'completed',
      conclusion: 'success',
      html_url: 'https://github.com/Khaos-Krew/Khaos-Nexus/actions/runs/101',
      created_at: '2026-08-20T22:30:00.000Z',
      updated_at: '2026-08-20T22:40:00.000Z'
    },
    {
      id: 102,
      name: 'Android Owner Test',
      head_branch: 'owner-test/android-resume-v0.41.2',
      head_sha: 'abc123abc123abc123',
      status: 'completed',
      conclusion: 'success',
      html_url: 'https://github.com/Khaos-Krew/Khaos-Nexus/actions/runs/102',
      created_at: '2026-08-20T22:31:00.000Z',
      updated_at: '2026-08-20T22:41:00.000Z'
    }
  ];

  const fetchImpl = async (url) => {
    if (url.includes('/actions/runs/101/artifacts')) return response({ artifacts: [{ id: 201, name: 'Khaos-Nexus-Windows', expired: false }] });
    if (url.includes('/actions/runs/102/artifacts')) return response({ artifacts: [{ id: 202, name: 'Khaos-Nexus-Mobile-Android-0.41.2-B-owner-test', expired: false }] });
    if (url.includes('/actions/runs?')) return response({ workflow_runs: runs });
    if (url.includes('/releases?')) {
      const releases = [{ id: 301, tag_name: 'v0.41.1-B', prerelease: true, draft: false, published_at: '2026-08-19T20:00:00.000Z', html_url: 'https://github.com/Khaos-Krew/Khaos-Nexus/releases/tag/v0.41.1-B', assets: [] }];
      if (releasePhase > 0) releases.unshift({ id: 302, tag_name: 'v0.41.2-B', prerelease: true, draft: false, published_at: '2026-08-20T23:05:00.000Z', html_url: 'https://github.com/Khaos-Krew/Khaos-Nexus/releases/tag/v0.41.2-B', assets: [] });
      return response(releases);
    }
    throw new Error(`Unexpected GitHub URL: ${url}`);
  };

  const service = new SentinelBuildFeedService({
    configStore: configStore(),
    dataDirectory: tempDirectory(),
    restFactory: () => rest,
    fetchImpl,
    now: () => new Date('2026-08-20T23:10:00.000Z')
  });

  const first = await service.poll();
  assert.equal(first.ok, true);
  assert.equal(messages.length, 1);
  assert.match(messages[0].body.embeds[0].title, /Testing Needed/);

  const second = await service.poll();
  assert.equal(second.ok, true);
  assert.equal(messages.length, 1);

  releasePhase = 1;
  const third = await service.poll();
  assert.equal(third.ok, true);
  assert.equal(messages.length, 2);
  assert.match(messages[1].body.embeds[0].title, /New Beta/);
});

test('combined Windows and Android checklist includes end-to-end pairing and explicit pass/fail guidance', () => {
  const checklist = testChecklist(['Windows', 'Android'], 'owner-test/mobile');
  assert.ok(checklist.some((item) => /pair Android/i.test(item)));
  assert.ok(checklist.some((item) => /PASS or ❌ FAIL/i.test(item)));
});

test('production entry installs Sentinel build feed before loading the desktop entry', () => {
  const entry = fs.readFileSync(path.join(__dirname, '..', 'main', 'entry-pdf-import.cjs'), 'utf8');
  const buildFeed = entry.indexOf("require('./sentinel-build-feed-extension.cjs').install()");
  const desktopEntry = entry.indexOf("require('./entry.cjs')");
  assert.ok(buildFeed >= 0);
  assert.ok(desktopEntry > buildFeed);
});

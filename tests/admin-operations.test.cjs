'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { BackendRuntime } = require('../src/backend/core/runtime.cjs');
const { OwnerTestService } = require('../src/desktop/owner-test-service.cjs');
const { SentinalAdminClient } = require('../src/desktop/sentinal-admin-client.cjs');
const { safeSentinalAdminUrl } = require('../src/desktop/config-store.cjs');
const { createSentinalAdminServer, safeModuleId } = require('../src/sentinel/admin-server.cjs');
const { StateStore } = require('../src/sentinel/state-store.cjs');
const { sanitizeAdminSettings } = require('../src/sentinel/admin-ops.cjs');
const { NEXUS_RANKS, highestRankForEntitlements } = require('../src/shared/ranks.cjs');

function temporaryRoot(prefix = 'nexus-admin-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('canonical Nexus rank order remains stable', () => {
  assert.deepEqual(NEXUS_RANKS.map((rank) => rank.name), [
    'Shadow Recruit', 'Cipher Runner', 'Nexus Raider', 'Khaos Warden', 'Blackout Legend', 'Origin Founder'
  ]);
  assert.deepEqual(NEXUS_RANKS.map((rank) => rank.level), [0, 1, 2, 3, 4, 5]);
});

test('entitlements resolve to the highest active configured Nexus rank', () => {
  const config = { discord: { rankSkus: {
    'cipher-runner': ['111111111111111'],
    'khaos-warden': ['222222222222222'],
    'blackout-legend': ['333333333333333']
  } } };
  const rank = highestRankForEntitlements([
    { sku_id: '111111111111111' },
    { sku_id: '222222222222222' },
    { sku_id: '333333333333333', ends_at: '2020-01-01T00:00:00.000Z' }
  ], config);
  assert.equal(rank.id, 'khaos-warden');
});

test('Sentinal admin settings discard unknown ranks, invalid snowflakes and unknown modules', () => {
  const settings = sanitizeAdminSettings({
    rankRoles: { 'cipher-runner': '123456789012345678', evil: '999999999999999999' },
    rankSkus: { 'cipher-runner': ['222222222222222222', 'bad'], evil: ['999999999999999999'] },
    moduleEnabled: { ark: false, evil: true }
  });
  assert.equal(settings.rankRoles['cipher-runner'], '123456789012345678');
  assert.equal(settings.rankRoles.evil, undefined);
  assert.deepEqual(settings.rankSkus['cipher-runner'], ['222222222222222222']);
  assert.equal(settings.moduleEnabled.ark, false);
  assert.equal(settings.moduleEnabled.evil, undefined);
});

test('Sentinal admin URL only permits HTTPS remotely and HTTP on loopback', () => {
  assert.equal(safeSentinalAdminUrl('http://127.0.0.1:3220'), 'http://127.0.0.1:3220');
  assert.equal(safeSentinalAdminUrl('https://sentinal.example.test/control'), 'https://sentinal.example.test/control');
  assert.equal(safeSentinalAdminUrl('http://sentinal.example.test/control'), 'http://127.0.0.1:3220');
});

test('Sentinal admin server refuses public binding without an admin token', () => {
  assert.throws(() => createSentinalAdminServer({ host: '0.0.0.0', port: 3220, token: '' }), /requires a token/i);
  assert.equal(safeModuleId('../ark'), '');
  assert.equal(safeModuleId('ark'), 'ark');
});

test('Sentinal state persists non-secret admin settings separately from console state', () => {
  const root = temporaryRoot();
  try {
    const store = new StateStore(root);
    store.setAdminSettings({
      rankRoles: { 'cipher-runner': '123456789012345678' },
      rankSkus: { 'cipher-runner': ['222222222222222222'] },
      moduleEnabled: { ark: false }
    });
    const reopened = new StateStore(root).getAdminSettings();
    assert.equal(reopened.rankRoles['cipher-runner'], '123456789012345678');
    assert.deepEqual(reopened.rankSkus['cipher-runner'], ['222222222222222222']);
    assert.equal(reopened.moduleEnabled.ark, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('backend runtime module toggle removes actions and blocks invocation', async () => {
  const runtime = new BackendRuntime({ config: { modules: { warframe: { enabled: true } } }, providers: {} });
  assert.equal(runtime.manifests().find((module) => module.id === 'warframe').enabled, true);
  runtime.setModuleEnabled({ warframe: false });
  const manifest = runtime.manifests().find((module) => module.id === 'warframe');
  assert.equal(manifest.enabled, false);
  assert.deepEqual(manifest.availableActions, []);
  const result = await runtime.invoke('warframe', 'news', {}, { role: 'viewer' });
  assert.equal(result.ok, false);
  assert.equal(result.code, 'MODULE_DISABLED');
});

test('desktop Sentinal client synchronizes safe settings before a scan', async () => {
  const previous = process.env.NEXUS_TEST_SENTINAL_ADMIN_TOKEN;
  process.env.NEXUS_TEST_SENTINAL_ADMIN_TOKEN = 'test-token';
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (String(url).endsWith('/v1/config')) return new Response(JSON.stringify({ ok: true, settings: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
    if (String(url).endsWith('/v1/scan')) return new Response(JSON.stringify({ ok: true, settings: {}, sections: {} }), { status: 200, headers: { 'content-type': 'application/json' } });
    throw new Error(`Unexpected URL: ${url}`);
  };
  try {
    const client = new SentinalAdminClient({
      discord: {
        sentinalAdminUrl: 'https://sentinal.example.test',
        sentinalAdminTokenEnv: 'NEXUS_TEST_SENTINAL_ADMIN_TOKEN',
        rankRoles: { 'cipher-runner': '123456789012345678' },
        rankSkus: { 'cipher-runner': ['222222222222222222'] }
      },
      modules: { ark: { enabled: false } }
    }, { fetchImpl });
    const result = await client.scan();
    assert.equal(result.ok, true);
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /\/v1\/config$/);
    assert.equal(calls[0].options.headers.authorization, 'Bearer test-token');
    const payload = JSON.parse(calls[0].options.body);
    assert.equal(payload.moduleEnabled.ark, false);
    assert.equal(payload.rankRoles['cipher-runner'], '123456789012345678');
    assert.match(calls[1].url, /\/v1\/scan$/);
  } finally {
    if (previous === undefined) delete process.env.NEXUS_TEST_SENTINAL_ADMIN_TOKEN;
    else process.env.NEXUS_TEST_SENTINAL_ADMIN_TOKEN = previous;
  }
});

test('Owner Test feedback persists independently for each build version', () => {
  const root = temporaryRoot();
  try {
    const service = new OwnerTestService({ currentVersion: '0.1.5', userDataPath: root, fetchImpl: async () => { throw new Error('offline'); } });
    service.setFeedback('0.1.5', 'startup', 'working', 'Clean startup');
    service.setFeedback('0.1.5', 'roles', 'failed', 'Role hierarchy needs attention');
    service.setFeedback('0.1.6', 'startup', 'failed', 'Regression');
    const first = service.feedback('0.1.5');
    const next = service.feedback('0.1.6');
    assert.equal(first.counts.working, 1);
    assert.equal(first.counts.failed, 1);
    assert.equal(first.items.find((item) => item.id === 'startup').note, 'Clean startup');
    assert.equal(next.counts.failed, 1);
    assert.equal(next.items.find((item) => item.id === 'startup').note, 'Regression');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

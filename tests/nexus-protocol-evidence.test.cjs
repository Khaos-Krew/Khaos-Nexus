'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { ProtocolStore } = require('../src/sentinel/protocol/store.cjs');
const { ProtocolEngine } = require('../src/sentinel/protocol/engine.cjs');
const { createEvidenceHandler, sourceStatus, MAX_BYTES } = require('../src/sentinel/protocol/evidence.cjs');
const { createSentinalAdminServer } = require('../src/sentinel/admin-server.cjs');
const SECRET = 'test-source-secret-'.repeat(3);
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-evidence-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let time = 1000000;
  const now = () => time;
  const store = new ProtocolStore(root), engine = new ProtocolEngine({ store, now });
  engine.season({ seasonId: 's1', startAt: 0, endAt: 100000000 }, 'admin');
  const run = engine.create({ type: 'alpha-purge', maps: ['ARK_GEN1'], seasonId: 's1', minActiveSeconds: 30 }, 'admin');
  engine.transition(run.id, 'active', 'admin'); engine.join(run.id, '12345', '12345');
  const identities = { profileByArk: (eosId) => eosId === 'EOS_TEST_123' ? { discordUserId: '12345', arkAccounts: [{ eosId }] } : null };
  const env = { NEXUS_PROTOCOL_SOURCES: JSON.stringify([{ id: 'gen1', map: 'ARK_GEN1', metrics: ['active-seconds', 'alpha-kill'], tokenEnv: 'NEXUS_PROTOCOL_SOURCE_GEN1_TOKEN' }]), NEXUS_PROTOCOL_SOURCE_GEN1_TOKEN: SECRET };
  const handler = createEvidenceHandler({ env, engine, identities, now });
  const input = { version: 1, eventId: 'kill-1', runId: run.id, eosId: 'EOS_TEST_123', map: 'ARK_GEN1', metric: 'alpha-kill', amount: 1, at: time, factId: 'creature-instance-1' };
  const invoke = (payload = input, token = SECRET, sourceId = 'gen1') => {
    const req = Readable.from([Buffer.from(typeof payload === 'string' ? payload : JSON.stringify(payload))]);
    req.headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    return handler({ req, sourceId });
  };
  return { root, engine, store, run, env, handler, input, invoke, identities, now, advance: (ms) => { time += ms; } };
}
test('authenticated objective and active interval qualify the linked player; retries survive restart and completion', async (t) => {
  const f = fixture(t);
  assert.equal((await f.invoke()).body.code, 'ACCEPTED');
  f.advance(30000);
  const active = { ...f.input, eventId: 'active-1', metric: 'active-seconds', factId: undefined, amount: 30, at: f.now(), intervalStart: f.now() - 30000, active: true, alive: true, spectating: false };
  assert.equal((await f.invoke(active)).body.code, 'ACCEPTED');
  f.engine.transition(f.run.id, 'completed', 'admin'); f.advance(180000);
  const restart = createEvidenceHandler({ env: f.env, engine: new ProtocolEngine({ store: new ProtocolStore(f.root), now: f.now }), identities: f.identities, now: f.now });
  const req = Readable.from([Buffer.from(JSON.stringify(f.input))]); req.headers = { authorization: `Bearer ${SECRET}`, 'content-type': 'application/json' };
  assert.equal((await restart({ req, sourceId: 'gen1' })).body.code, 'DUPLICATE');
  assert.equal(f.engine.stats('12345').score, 100);
  assert.ok(f.store.read().receipts.some((r) => r.actor === 'adapter:gen1'));
});
test('untrusted credentials, display names, unlinked IDs, wrong maps and wrong metrics never grant credit', async (t) => {
  const f = fixture(t);
  assert.equal((await f.invoke(f.input, 'wrong')).status, 401);
  assert.equal((await f.invoke(f.input, SECRET, 'unknown')).status, 401);
  for (const input of [{ ...f.input, map: 'ARK_MAP2' }, { ...f.input, eosId: 'UNKNOWN_123' }, { ...f.input, playerName: 'Kirito' }, { ...f.input, metric: 'pvp-kill' }]) assert.equal((await f.invoke(input)).status, 422);
  assert.equal(f.store.read().receipts.length, 0);
});
test('future and stale evidence, AFK, dead and spectating intervals are rejected', async (t) => {
  const f = fixture(t);
  assert.equal((await f.invoke({ ...f.input, at: f.now() + 1 })).body.code, 'STALE_OR_FUTURE_EVIDENCE');
  f.advance(130000);
  assert.equal((await f.invoke()).body.code, 'STALE_OR_FUTURE_EVIDENCE');
  const interval = { ...f.input, metric: 'active-seconds', factId: undefined, amount: 30, at: f.now(), intervalStart: f.now() - 30000, active: true, alive: true, spectating: false };
  for (const flags of [{ active: false }, { alive: false }, { spectating: true }, { active: undefined }]) assert.equal((await f.invoke({ ...interval, ...flags })).status, 422);
  assert.equal(f.store.read().receipts.length, 0);
});
test('renaming event IDs cannot count a creature twice and changed retries conflict', async (t) => {
  const f = fixture(t);
  await f.invoke();
  assert.equal((await f.invoke({ ...f.input, eventId: 'renamed' })).body.code, 'DUPLICATE');
  assert.equal((await f.invoke({ ...f.input, factId: 'different-creature' })).status, 409);
  assert.equal(f.store.read().runs[0].participants[0].contribution, 1);
});
test('malformed and oversized requests fail without exposing credentials; status contains only counts', async (t) => {
  const f = fixture(t);
  assert.equal((await f.invoke('{')).status, 400);
  assert.equal((await f.invoke('x'.repeat(MAX_BYTES + 1))).status, 413);
  assert.deepEqual(sourceStatus(f.env), { ok: true, configured: 1, ready: 1 });
  assert.equal(JSON.stringify(sourceStatus(f.env)).includes(SECRET), false);
  assert.equal(sourceStatus({ NEXUS_PROTOCOL_SOURCES: '{' }).ok, false);
});
test('source rate limit applies to retries without creating additional credit', async (t) => {
  const f = fixture(t);
  for (let i = 0; i < 120; i += 1) assert.equal((await f.invoke()).status, 200);
  assert.equal((await f.invoke()).status, 429);
  assert.equal(f.store.read().runs[0].participants[0].contribution, 1);
});
test('real admin HTTP routing uses separate source credentials and leaves health and admin auth intact', async (t) => {
  const f = fixture(t);
  const admin = createSentinalAdminServer({ token: 'admin-secret-'.repeat(4), protocolEvidenceHandler: f.handler, logger: { log() {}, error() {} } });
  await new Promise((resolve) => admin.server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { admin.server.closeAllConnections(); await new Promise((resolve) => admin.server.close(resolve)); });
  const url = `http://127.0.0.1:${admin.server.address().port}`;
  const send = (token) => fetch(`${url}/v1/protocol/evidence/gen1`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(f.input) });
  assert.equal((await send('admin-secret-'.repeat(4))).status, 401);
  assert.equal((await send(SECRET)).status, 200);
  assert.equal((await fetch(`${url}/health`)).status, 200);
  assert.equal((await fetch(`${url}/v1/status`)).status, 401);
  assert.equal((await fetch(`${url}/v1/protocol/evidence/gen1`)).status, 405);
});
test('no configured source keeps the public intake disabled', async () => {
  const handler = createEvidenceHandler({ env: {} });
  const req = Readable.from([]); req.headers = {};
  assert.equal((await handler({ req, sourceId: 'gen1' })).body.code, 'PROTOCOL_TELEMETRY_DISABLED');
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProtocolStore } = require('../src/sentinel/protocol/store.cjs');
const { ProtocolEngine } = require('../src/sentinel/protocol/engine.cjs');
const { DarkZone, ACTIVATION_MS, WITHDRAWAL_MS, COMBAT_MS } = require('../src/sentinel/protocol/dark-zone.cjs');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nx-protocol-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new ProtocolStore(root); let time = 1000000;
  const now = () => time;
  const engine = new ProtocolEngine({ store, now });
  engine.season({ seasonId: 's1', startAt: 0, endAt: 100000000 }, 'admin');
  return { root, store, engine, now, advance: (ms) => { time += ms; } };
}
function run(f) {
  const r = f.engine.create({ type: 'alpha-purge', maps: ['ARK_GEN1'], seasonId: 's1', minActiveSeconds: 30 }, 'admin');
  f.engine.transition(r.id, 'active', 'admin'); f.engine.join(r.id, 'player', 'player'); return r;
}
test('qualification, non-spendable score and audit survive restart; duplicate evidence cannot mint twice', (t) => {
  const f = fixture(t), r = run(f), start = f.now(); f.advance(30000);
  const event = { runId: r.id, playerId: 'player', source: 'adapter', eventId: 'activity-1', map: 'ARK_GEN1', metric: 'active-seconds', amount: 30, at: f.now(), intervalStart: start, evidence: 'verified active interval' };
  f.engine.record(event, 'trusted-adapter');
  const restarted = new ProtocolEngine({ store: new ProtocolStore(f.root), now: f.now });
  assert.equal(restarted.record(event, 'trusted-adapter').duplicate, true);
  assert.throws(() => restarted.record({ ...event, amount: 29 }, 'trusted-adapter'), /reused/);
  restarted.record({ ...event, eventId: 'creature-123', metric: 'alpha-kill', amount: 1, intervalStart: undefined }, 'trusted-adapter');
  restarted.transition(r.id, 'completed', 'admin');
  assert.equal(restarted.stats('player').score, 100);
  assert.equal(restarted.stats('player', 's1').completions, 1);
  assert.throws(() => restarted.transition(r.id, 'completed', 'admin'), /transition/);
  assert.equal(f.store.read().awards.length, 1);
  assert.ok(f.store.read().audit.some((a) => a.action.startsWith('participation.record') && a.actor === 'trusted-adapter'));
});
test('joins, wrong maps, AFK gaps, overlapping intervals, pause time and disqualification cannot qualify', (t) => {
  const f = fixture(t), r = run(f), start = f.now(); f.advance(30000);
  const event = { runId: r.id, playerId: 'player', source: 'adapter', eventId: 'x', map: 'WRONG', metric: 'active-seconds', amount: 30, at: f.now(), intervalStart: start, evidence: 'verified activity' };
  assert.throws(() => f.engine.record(event, 'adapter'), /scope/);
  f.engine.record({ ...event, map: 'ARK_GEN1' }, 'adapter');
  assert.throws(() => f.engine.record({ ...event, map: 'ARK_GEN1', eventId: 'y' }, 'adapter'), /integer/);
  f.engine.transition(r.id, 'paused', 'admin'); f.advance(30000); f.engine.transition(r.id, 'active', 'admin');
  assert.throws(() => f.engine.record({ ...event, map: 'ARK_GEN1', at: f.now(), eventId: 'z' }, 'adapter'), /integer/);
  f.engine.disqualify(r.id, 'player', 'Invalid activity', 'admin');
  f.engine.transition(r.id, 'completed', 'admin'); assert.equal(f.engine.stats('player').score, 0);
});
test('storage corruption, concurrent lock and failed transaction never reset or partially award state', (t) => {
  const f = fixture(t); const before = fs.readFileSync(f.store.file, 'utf8');
  assert.throws(() => f.store.transact('admin', 'fail', (s) => { s.awards.push({}); throw new Error('stop'); }), /stop/);
  assert.equal(fs.readFileSync(f.store.file, 'utf8'), before);
  fs.writeFileSync(`${f.store.file}.lock`, 'other');
  assert.throws(() => f.engine.season({ seasonId: 's2', startAt: 100000001, endAt: 200000000 }, 'admin'), /busy/);
  fs.unlinkSync(`${f.store.file}.lock`);
  fs.writeFileSync(f.store.file, before.replace('"revision":1', '"revision":99'));
  assert.throws(() => f.store.read(), /integrity/);
});
test('seasons retain lifetime totals and reject overlap; expired runs reject credit', (t) => {
  const f = fixture(t), r = run(f);
  assert.throws(() => f.engine.season({ seasonId: 's2', startAt: 1, endAt: 100 }, 'admin'), /overlapping/);
  f.advance(3600000);
  assert.throws(() => f.engine.join(r.id, 'late', 'late'), /not active/);
  f.engine.transition(r.id, 'failed', 'admin'); assert.equal(f.engine.stats('player').score, 0);
  assert.equal(f.engine.stats('player', 'future').participations, 0);
});
test('Dark Zone defaults protected and cannot enlist without enforcement and consent', (t) => {
  const f = fixture(t), dz = new DarkZone({ store: f.store, now: f.now });
  assert.equal(dz.status('player', 'a').state, 'SAFE');
  assert.throws(() => dz.enlist('player', 'a', 'a', { confirmed: true, ownershipVerified: true }), /CONTAINED/);
  assert.equal(dz.canDamage({ playerId: 'a', tribeId: 'a' }, { kind: 'player', playerId: 'b', tribeId: 'b' }), false);
});
test('both players must opt in; solo enrollment never exposes bases; combat delays withdrawal across restart', (t) => {
  const f = fixture(t), options = { store: f.store, now: f.now, enforcementReady: () => true }, dz = new DarkZone(options);
  const consent = { confirmed: true, ownershipVerified: true };
  const a = { playerId: 'a', tribeId: 'ta' }, b = { kind: 'player', playerId: 'b', tribeId: 'tb' };
  dz.enlist('player', 'a', 'a', consent); dz.enlist('player', 'b', 'b', consent);
  assert.equal(dz.canDamage(a, b), false); f.advance(ACTIVATION_MS);
  assert.equal(dz.canDamage(a, b), true);
  assert.equal(dz.canDamage(a, { kind: 'structure', id: 'base', tribeId: 'tb' }), false);
  assert.equal(dz.canDamage(a, { ...b, tribeId: 'ta' }), false);
  dz.withdraw('player', 'a', 'a', consent); f.advance(WITHDRAWAL_MS - 1000);
  dz.combat(a, b, 'damage-1', 'adapter'); f.advance(2000);
  const restarted = new DarkZone(options);
  assert.equal(restarted.status('player', 'a').state, 'COOLDOWN');
  f.advance(COMBAT_MS); assert.equal(restarted.status('player', 'a').state, 'SAFE');
  assert.equal(restarted.canDamage(a, b), false);
});
test('same-pair kill farming and missing ownership deny credit', (t) => {
  const f = fixture(t), dz = new DarkZone({ store: f.store, now: f.now, enforcementReady: () => true });
  for (const p of ['a', 'b']) dz.enlist('player', p, p, { confirmed: true, ownershipVerified: true });
  f.advance(ACTIVATION_MS);
  const a = { playerId: 'a', tribeId: 'ta' }, b = { kind: 'player', playerId: 'b', tribeId: 'tb' };
  assert.equal(dz.validateKill(a, b, 'kill1', 'adapter').eligible, true);
  assert.equal(dz.validateKill(a, b, 'kill2', 'adapter').eligible, false);
  assert.equal(dz.canDamage(a, { ...b, tribeId: null }), false);
});

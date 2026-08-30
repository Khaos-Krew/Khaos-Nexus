'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ArkEventRuntimeStore, ArkEventService } = require('../src/sentinel/ark-event-service.cjs');
const { EVENT_CHOICES, arkCommand, formatArkEventStatus, formatAnomalyProposal } = require('../src/sentinel/ark-ops-extension.cjs');

class FakeRcon {
  constructor() { this.commands = []; this.fail = false; }
  async execute(command) { this.commands.push(command); if (this.fail) throw new Error('transport uncertain'); return 'ok'; }
}

function fixture() {
  let now = Date.UTC(2026, 7, 29, 12, 0, 0);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-ark-events-'));
  const rcon = new FakeRcon();
  const store = new ArkEventRuntimeStore({ root, now: () => now });
  const service = new ArkEventService({ rcon, store, mapId: 'gen1', mapName: 'Genesis 1', rng: () => 0, now: () => now });
  return { rcon, store, service, advance(ms) { now += ms; } };
}

test('staff-started event persists objective, target, window, and Nexus broadcasts', async () => {
  const { service, rcon } = fixture();
  const result = await service.start({ eventId: 'alpha-hunt', objective: 'Defeat 10 natural Alpha creatures', target: 10, actorId: 'staff-1' });
  assert.equal(result.ok, true);
  assert.equal(result.event.state, 'active');
  assert.equal(result.event.target, 10);
  assert.equal(rcon.commands.length, 3);
  assert.match(rcon.commands[0], /Genesis 1.*Alpha Hunt/);
});

test('event progress is bounded, persisted, and only applies to an active event', async () => {
  const { service } = fixture();
  assert.equal(service.progress({ amount: 1 }).reason, 'no-active-event');
  await service.start({ eventId: 'community-goal', target: 100 });
  const result = service.progress({ amount: 25, note: 'First turn-in', actorId: 'staff-1' });
  assert.equal(result.event.progress, 25);
  assert.equal(result.event.notes.length, 1);
  assert.equal(service.progress({ amount: -1 }).reason, 'invalid-progress');
});

test('completion activates a reward-cache hook and enforces the event cooldown', async () => {
  const { service, advance } = fixture();
  await service.start({ eventId: 'supply-rush' });
  const finished = await service.finish({ outcome: 'Caches recovered', actorId: 'staff-1' });
  assert.equal(finished.event.rewardHook.state, 'ready-for-staff-award');
  assert.equal((await service.start({ eventId: 'supply-rush' })).reason, 'cooldown');
  advance(241 * 60_000);
  assert.equal((await service.start({ eventId: 'supply-rush' })).ok, true);
});

test('expired event windows finish automatically without destructive commands', async () => {
  const { service, advance, rcon } = fixture();
  await service.start({ eventId: 'alpha-hunt' });
  advance(46 * 60_000);
  const tick = await service.tick();
  assert.equal(tick.changed, true);
  assert.equal(tick.event.state, 'finished');
  assert.equal(rcon.commands.some((command) => /Destroy|Kill|SpawnDino/i.test(command)), false);
});

test('uncertain event announcement is retained for review rather than duplicated', async () => {
  const { service, rcon } = fixture();
  rcon.fail = true;
  const result = await service.start({ eventId: 'blood-moon' });
  assert.equal(result.reason, 'announcement-review');
  assert.equal(result.event.state, 'announcement-review');
  assert.equal((await service.start({ eventId: 'blood-moon' })).reason, 'event-already-active');
});

test('anomaly proposal is journaled with no executable spawn command', () => {
  const { service, store } = fixture();
  const result = service.proposeAnomaly({ actorId: 'staff-1', baseMaxLevel: 150 });
  assert.equal(result.ok, true);
  assert.equal(result.proposal.state, 'proposed');
  assert.equal(result.proposal.plan.autoSpawn, false);
  assert.equal(JSON.stringify(result.proposal).includes('SpawnDino'), false);
  assert.equal(store.read().anomalyProposals.length, 1);
});

test('/ark exposes every approved event plus lifecycle and anomaly staff controls', () => {
  assert.deepEqual(EVENT_CHOICES.map((item) => item.value), ['supply-rush', 'alpha-hunt', 'anomaly-surge', 'blood-moon', 'community-goal']);
  const command = arkCommand().toJSON();
  for (const name of ['event-start', 'event-status', 'event-progress', 'event-finish', 'anomaly-propose']) assert.ok(command.options.find((item) => item.name === name));
});

test('event and anomaly formatting remains public-safe and states that no spawn occurred', () => {
  const status = formatArkEventStatus({ ok: true, event: { label: 'Alpha Hunt', state: 'active', objective: 'Defeat alphas', progress: 2, target: 10, endsAt: '2026-08-29T13:00:00Z' } });
  assert.match(status, /2\/10/);
  const proposal = formatAnomalyProposal({ proposal: { id: 'proposal-1', anomaly: { tier: 'Aberrant', species: 'Rex', targetLevel: 160, rewardMultiplier: 1 } } });
  assert.match(proposal, /No creature was spawned/);
  assert.doesNotMatch(proposal, /blueprint|SpawnDino/);
});

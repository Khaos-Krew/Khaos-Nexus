'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { SharedScheduler, parseAddInput, timeParts } = require('../src/backend/core/scheduler.cjs');

function tempFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-scheduler-'));
  return { dir, file: path.join(dir, 'schedules.json') };
}

test('daily schedule input is normalized and validated', () => {
  assert.deepEqual(parseAddInput({ input: 'daily 6:05 broadcast Restart in 10 minutes' }), {
    mode: 'daily', time: '06:05', actionId: 'broadcast', payload: { input: 'Restart in 10 minutes' }
  });
  assert.throws(() => parseAddInput({ input: 'daily 26:00 restart' }), /valid 24-hour/);
});

test('scheduler adds lists removes and persists module schedules', () => {
  const { dir, file } = tempFile();
  try {
    const scheduler = new SharedScheduler({ filePath: file, timeZone: 'America/Chicago' });
    const added = scheduler.add('ark', { input: 'daily 06:00 restart' }, { actorId: 'owner-1' });
    assert.match(added.schedule.id, /^[a-f0-9]{10}$/);
    assert.equal(scheduler.list('ark').length, 1);
    const reloaded = new SharedScheduler({ filePath: file, timeZone: 'America/Chicago' });
    assert.equal(reloaded.list('ark').length, 1);
    reloaded.remove('ark', { input: added.schedule.id });
    assert.equal(reloaded.list('ark').length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('scheduler executes a due daily action only once per local day', async () => {
  const { dir, file } = tempFile();
  try {
    const fixed = new Date('2026-08-23T11:00:00Z');
    const local = timeParts(fixed, 'America/Chicago');
    const calls = [];
    const scheduler = new SharedScheduler({ filePath: file, timeZone: 'America/Chicago', now: () => fixed });
    scheduler.add('ark', { input: `daily ${local.time} broadcast Scheduled test` }, { actorId: 'owner-1' });
    scheduler.registerExecutor(async (...args) => { calls.push(args); return { ok: true }; });
    await scheduler.tick();
    await scheduler.tick();
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'ark');
    assert.equal(calls[0][1], 'broadcast');
    assert.deepEqual(calls[0][2], { input: 'Scheduled test' });
    assert.equal(calls[0][3].confirmed, true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

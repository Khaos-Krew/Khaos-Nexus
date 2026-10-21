'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_DOWN_MINUTES,
  ServerAlertMonitor,
  downMinutes,
  renderServerAlert
} = require('../src/sentinel/server-down-alerts.cjs');

function craftGroup(skyblock, atm10) {
  return [
    {
      id: 'minecraft:env', game: 'Minecraft', name: 'Nexus Craft', kind: 'group', joins: [],
      servers: [
        { id: 'minecraft:env:join', game: 'Minecraft', name: 'Skyblock', status: skyblock },
        { id: 'minecraft:atm10', game: 'Minecraft', name: 'ATM10', status: atm10 }
      ]
    },
    { id: 'ark:gen1', game: 'ARK', name: 'Gen1', status: 'Online' }
  ];
}

test('SERVER_DOWN_MINUTES defaults to 5 and accepts overrides', () => {
  assert.equal(DEFAULT_DOWN_MINUTES, 5);
  assert.equal(downMinutes({}), 5);
  assert.equal(downMinutes({ SERVER_DOWN_MINUTES: '10' }), 10);
  assert.equal(downMinutes({ SERVER_DOWN_MINUTES: 'junk' }), 5);
  assert.equal(downMinutes({ SERVER_DOWN_MINUTES: '-1' }), 5);
});

test('a grouped child offline past the threshold alerts by its own name while siblings stay up', () => {
  let now = 1_000_000;
  const monitor = new ServerAlertMonitor({ file: null, now: () => now, env: {} });
  const all = [];
  for (let minute = 0; minute <= 5; minute += 1) {
    all.push(...monitor.observe(craftGroup('Online', 'Offline')));
    if (minute < 5) assert.equal(all.length, 0, `no alert at minute ${minute}`);
    now += 60_000;
  }
  assert.equal(all.length, 1);
  assert.equal(all[0].type, 'down');
  assert.equal(all[0].name, 'ATM10');
  assert.equal(all[0].game, 'Minecraft');
  assert.ok(monitor.servers['minecraft|atm10']);
  assert.ok(monitor.servers['minecraft|skyblock']);
  assert.match(renderServerAlert(all).content, /ATM10/);
  // No repeat while it stays down.
  assert.deepEqual(monitor.observe(craftGroup('Online', 'Offline')), []);
});

test('a short restart blip under the threshold never alerts', () => {
  let now = 0;
  const monitor = new ServerAlertMonitor({ file: null, now: () => now, env: {} });
  for (let minute = 0; minute < 3; minute += 1) {
    assert.deepEqual(monitor.observe(craftGroup('Online', 'Offline')), []);
    now += 60_000;
  }
  assert.deepEqual(monitor.observe(craftGroup('Online', 'Online')), []);
  now += 60_000;
  assert.deepEqual(monitor.observe(craftGroup('Online', 'Offline')), []);
});

test('recovery of a grouped child sends back online with downtime', () => {
  let now = 1_000_000;
  const monitor = new ServerAlertMonitor({ file: null, now: () => now, env: { SERVER_DOWN_MINUTES: '2' } });
  for (let minute = 0; minute <= 2; minute += 1) { monitor.observe(craftGroup('Online', 'Offline')); now += 60_000; }
  const events = monitor.observe(craftGroup('Online', 'Online'));
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'up');
  assert.equal(events[0].name, 'ATM10');
  assert.equal(events[0].downMs, 180_000);
  assert.match(renderServerAlert(events).content, /ATM10\*\* is \*\*back online\*\* after 3m/);
});

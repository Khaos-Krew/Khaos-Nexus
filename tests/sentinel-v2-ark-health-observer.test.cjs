'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { IncidentTracker } = require('../src/sentinel-v2/incidents.cjs');
const { ArkHealthObserver, arkHealthFingerprint } = require('../src/sentinel-v2/ark-health-observer.cjs');
const { ArkServerRegistry } = require('../src/sentinel-v2/ark-server-registry.cjs');

test('ARK health observer opens, updates, and recovers one stable incident per server', async () => {
  const tracker = new IncidentTracker();
  const incidents = {
    observe: async (input) => tracker.observe(input),
    recover: async (fingerprint) => tracker.recover(fingerprint),
  };
  const audit = [];
  const observer = new ArkHealthObserver({
    incidents,
    auditStore: { async append(entry) { audit.push(entry); return entry; } },
  });

  const degraded = {
    health: [{
      serverId: 'astraeos',
      serverName: 'Astraeos',
      ok: false,
      degraded: true,
      errors: ['SFTP timeout'],
      checkedAt: '2026-09-09T19:00:00.000Z',
    }],
  };

  const first = await observer.observe(degraded);
  assert.equal(first[0].type, 'opened');
  assert.equal(first[0].fingerprint, arkHealthFingerprint('astraeos'));
  assert.equal(audit.length, 1);
  assert.equal(audit[0].action, 'sentinel.ark.health.degraded');

  degraded.health[0].errors = ['Different transient failure'];
  const second = await observer.observe(degraded);
  assert.equal(second[0].type, 'updated');
  assert.equal(tracker.listOpen().length, 1);
  assert.equal(tracker.listOpen()[0].occurrences, 2);
  assert.equal(audit.length, 1, 'repeat degraded observations should not spam audit transitions');

  const recovered = await observer.observe({
    health: [{ serverId: 'astraeos', serverName: 'Astraeos', ok: true, degraded: false, errors: [] }],
  });
  assert.equal(recovered[0].type, 'recovered');
  assert.equal(tracker.listOpen().length, 0);
  assert.equal(audit.length, 2);
  assert.equal(audit[1].action, 'sentinel.ark.health.recovered');
});

test('ARK server registry boundary exposes read-only clones', () => {
  const source = [{ id: 'gen1', name: 'Gen 1', enabled: true, nested: { value: 1 } }];
  const legacy = {
    list() { return source; },
    get(id) { return id === 'gen1' ? source[0] : null; },
  };
  const registry = new ArkServerRegistry({ registry: legacy });
  const listed = registry.list();
  listed[0].nested.value = 99;
  assert.equal(source[0].nested.value, 1);
  assert.deepEqual(registry.get('gen1'), source[0]);
  assert.equal(typeof registry.upsert, 'undefined');
  assert.equal(typeof registry.remove, 'undefined');
});

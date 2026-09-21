'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseListPlayers } = require('../src/sentinel/ark-cluster-monitor.cjs');
const { ArkEconomyPresenceBridge } = require('../src/sentinel/ark-economy-presence-bridge.cjs');
const { runPresenceCycle } = require('../src/sentinel/ark-economy-presence-extension.cjs');

function recordingLogger() {
  const lines = [];
  return {
    lines,
    log(line) { lines.push(String(line)); },
    warn(line) { lines.push(String(line)); }
  };
}

function bridgeWith(logger, presence) {
  const calls = [];
  return {
    calls,
    bridge: new ArkEconomyPresenceBridge({
      client: {
        configured: () => true,
        presence: async (input) => {
          calls.push(input);
          if (presence) return presence(input);
          return { ok: true };
        }
      },
      logger
    })
  };
}

test('presence cycle self-polls before sync and logs non-authoritative maps', async () => {
  const logger = recordingLogger();
  const { calls, bridge } = bridgeWith(logger);
  const order = [];
  const registry = {
    list() {
      throw new Error('registry.list should not run when the poll snapshot has servers');
    }
  };
  const result = await runPresenceCycle({
    registry,
    bridge,
    poll: async (seen) => {
      order.push('poll');
      assert.equal(seen, registry);
      return {
        servers: [
          {
            id: 'gen1',
            enabled: true,
            runtime: {
              state: 'offline',
              lastError: 'connect ETIMEDOUT\npassword=secret-value',
              players: [{ name: 'Should Not Sync', eosId: '0002aabbccddeeff0011223344556677' }]
            }
          },
          { id: 'hidden', enabled: false, runtime: { state: 'online', lastError: '', players: [] } }
        ]
      };
    }
  });

  assert.deepEqual(order, ['poll']);
  assert.deepEqual(calls, []);
  assert.equal(result.maps, 1);
  assert.equal(result.skips, 2);
  assert.equal(result.failures, 0);
  assert.match(logger.lines[0], /presence skip server=gen1 reason=runtime-not-authoritative state=offline error=connect ETIMEDOUT password=\[redacted\]/);
  assert.match(logger.lines[1], /presence skip server=hidden reason=disabled/);
  assert.equal(result.results[0].error.includes('secret-value'), false);
});

test('authoritative poll writes online presence and does not treat a later failed poll as logout', async () => {
  const logger = recordingLogger();
  const { calls, bridge } = bridgeWith(logger);
  const eosId = '0002f8bdae234238b0d398ae179826fb';
  const online = {
    id: 'gen1',
    enabled: true,
    runtime: { state: 'online', lastError: '', players: [{ name: 'Khaos_Asuna', eosId }] }
  };

  const first = await runPresenceCycle({
    registry: {},
    bridge,
    poll: async () => ({ servers: [online] })
  });
  assert.equal(first.skips, 0);
  assert.deepEqual(calls, [{ eosId, online: true, server: 'gen1' }]);
  assert.equal(logger.lines.length, 0);

  calls.length = 0;
  const second = await runPresenceCycle({
    registry: {},
    bridge,
    poll: async () => ({
      servers: [{
        id: 'gen1',
        enabled: true,
        runtime: { state: 'offline', lastError: 'RCON not configured for this map.', players: [] }
      }]
    })
  });
  assert.deepEqual(calls, []);
  assert.equal(second.skips, 1);
  assert.match(logger.lines[0], /server=gen1 reason=runtime-not-authoritative state=offline error=RCON not configured for this map\./);
});

test('ListPlayers parse keeps the single-id form and prefers an EOS id when Steam is also present', () => {
  const existing = parseListPlayers('0. Khaos_Asuna, 0002f8bdae234238b0d398ae179826fb\n1. Player Two, abc_DEF-123');
  assert.deepEqual(existing, [
    { name: 'Khaos_Asuna', eosId: '0002f8bdae234238b0d398ae179826fb' },
    { name: 'Player Two', eosId: 'abc_DEF-123' }
  ]);

  const richer = parseListPlayers('0. Khaos_Asuna, 76561198000000001, EOS_0002f8bdae234238b0d398ae179826fb');
  assert.deepEqual(richer, [
    { name: 'Khaos_Asuna', eosId: '0002f8bdae234238b0d398ae179826fb' }
  ]);

  assert.deepEqual(parseListPlayers('No Players Connected'), []);
});

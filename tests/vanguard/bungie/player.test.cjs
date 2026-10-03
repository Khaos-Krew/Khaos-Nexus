'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createCache } = require('../../../src/game-bots/vanguard/bungie/cache.cjs');
const { createBungieClient } = require('../../../src/game-bots/vanguard/bungie/client.cjs');
const { lookupPlayer, parseBungieName } = require('../../../src/game-bots/vanguard/bungie/player.cjs');
const { createBungieRuntime } = require('../../../src/game-bots/vanguard/bungie/runtime.cjs');

function manifest() {
  return {
    nameFor(table, hash) {
      if (table === 'DestinyClassDefinition' && Number(hash) === 671679327) return 'Hunter';
      return '';
    },
    definition(table, hash) {
      if (table === 'DestinyInventoryItemDefinition' && Number(hash) === 99) {
        return { displayProperties: { name: 'Young Ahamkara\'s Spine' }, inventory: { tierType: 6, tierTypeName: 'Exotic' } };
      }
      return null;
    }
  };
}

function clientFor(routes) {
  const calls = [];
  return {
    calls,
    async post(pathname, body) {
      calls.push({ method: 'POST', pathname, body });
      return routes.post(pathname, body);
    },
    async get(pathname, query) {
      calls.push({ method: 'GET', pathname, query });
      return routes.get(pathname, query);
    }
  };
}

test('player lookup covers a public profile, a missing account, private data, and cross-save', async () => {
  assert.equal(parseBungieName('Ada#7').label, 'Ada#0007');
  assert.equal(parseBungieName('nope'), null);
  const cache = createCache({ now: () => 0 });
  const found = clientFor({
    post: () => ({
      ok: true,
      json: { ErrorCode: 1, Response: [{ membershipType: 3, membershipId: '100', bungieGlobalDisplayName: 'Ada', bungieGlobalDisplayNameCode: 7 }] }
    }),
    get: (pathname) => {
      if (pathname.includes('LinkedProfiles')) {
        return {
          ok: true,
          json: { Response: { profiles: [
            { membershipType: 1, membershipId: '50' },
            { membershipType: 3, membershipId: '100', isCrossSavePrimary: true }
          ] } }
        };
      }
      return {
        ok: true,
        json: {
          Response: {
            characters: { privacy: 1, data: { a: { classHash: 671679327, light: 200 } } },
            characterEquipment: { privacy: 1, data: { a: { items: [{ itemHash: 99 }, { itemHash: 5 }] } } }
          }
        }
      };
    }
  });
  const view = await lookupPlayer({ client: found, manifest: manifest(), cache, rawName: 'Ada#7' });
  assert.equal(view.ok, true);
  assert.match(view.text, /Ada#0007/);
  assert.match(view.text, /Cross-save primary: Steam/);
  assert.match(view.text, /Hunter — 200 Light/);
  assert.match(view.text, /Young Ahamkara's Spine/);
  const again = await lookupPlayer({ client: found, manifest: manifest(), cache, rawName: 'Ada#7' });
  assert.equal(again.text, view.text);
  assert.equal(found.calls.length, 3);

  const missing = clientFor({
    post: () => ({ ok: false, kind: 'not-found', reason: 'no-account' }),
    get: () => ({ ok: false })
  });
  const lost = await lookupPlayer({ client: missing, cache: createCache(), rawName: 'Missing#1' });
  assert.equal(lost.reason, 'not-found');
  assert.equal(missing.calls.filter((call) => call.method === 'GET').length, 0);

  const hidden = clientFor({
    post: () => ({ ok: false, kind: 'privacy', reason: 'private' }),
    get: () => ({ ok: false })
  });
  const priv = await lookupPlayer({ client: hidden, cache: createCache(), rawName: 'Hidden#2' });
  assert.equal(priv.reason, 'private');

  const partial = clientFor({
    post: () => ({ ok: true, json: { Response: [{ membershipType: 3, membershipId: '9' }] } }),
    get: (pathname) => {
      if (pathname.includes('LinkedProfiles')) return { ok: true, json: { Response: { profiles: [] } } };
      return { ok: true, json: { Response: { characters: { privacy: 2 }, characterEquipment: { data: null } } } };
    }
  });
  const masked = await lookupPlayer({ client: partial, manifest: manifest(), cache: createCache(), rawName: 'Mask#3' });
  assert.match(masked.text, /Characters: Private/);
  assert.match(masked.text, /Exotics: Private/);
});

test('player data stays in memory and the lookup is rate limited', async () => {
  const source = ['player.cjs', 'cache.cjs', 'commands/d2-player.cjs']
    .map((file) => fs.readFileSync(path.join(__dirname, '../../../src/game-bots/vanguard', file.includes('/') ? file : `bungie/${file}`), 'utf8'))
    .join('\n');
  assert.doesNotMatch(source, /writeFile|writeJson|fs\./);
  let time = 1_000;
  const runtime = createBungieRuntime({
    env: {
      BUNGIE_API_KEY: 'present',
      VANGUARD_PLAYER_LOOKUP_ENABLED: 'true',
      VANGUARD_DATA_DIR: fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'vanguard-player-'))
    },
    now: () => time,
    sleep: async () => {},
    channelsFor: () => ({}),
    panelStore: { read: () => ({}), update: async (fn) => fn({}) },
    fetch: async (url) => ({
      status: String(url).endsWith('/Settings/') ? 200 : 200,
      headers: { get: () => 'application/json' },
      async text() {
        if (String(url).endsWith('/Settings/')) {
          return JSON.stringify({ ErrorCode: 1, Response: { systems: { Destiny2: { enabled: true }, D2Profiles: { enabled: true } } } });
        }
        return JSON.stringify({ ErrorCode: 1601, Response: null });
      }
    })
  });
  await runtime.health.poll(runtime.api);
  const first = await runtime.player('Nobody#1', 'user-1');
  const second = await runtime.player('Nobody#1', 'user-1');
  assert.equal(first.reason, 'not-found');
  assert.equal(second.reason, 'rate');
  time += 11_000;
  const third = await runtime.player('Nobody#1', 'user-1');
  assert.equal(third.reason, 'not-found');
});

test('a non-JSON or schema-less 200 is not cached as not-found', async () => {
  const bodies = [
    { status: 200, headers: { get: () => 'text/plain' }, async text() { return 'nope'; } },
    {
      status: 200,
      headers: { get: () => 'application/json' },
      async text() { return JSON.stringify({ ok: true }); }
    }
  ];
  for (const response of bodies) {
    let calls = 0;
    const cache = createCache({ now: () => 5_000_000 });
    const client = createBungieClient({
      env: { BUNGIE_API_KEY: 'present' },
      sleep: async () => {},
      log: () => {},
      warn: () => {},
      fetch: async () => {
        calls += 1;
        return response;
      }
    });
    const first = await lookupPlayer({ client, cache, rawName: 'Ghost#1234' });
    const second = await lookupPlayer({ client, cache, rawName: 'Ghost#1234' });
    assert.equal(first.ok, false);
    assert.equal(first.reason, 'bad-body');
    assert.equal(second.reason, 'bad-body');
    assert.equal(calls, 2);
    assert.equal(cache.get('player:ghost#1234'), undefined);
  }
});

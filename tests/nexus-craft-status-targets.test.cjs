'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ALL_SERVERS_VALUE,
  ATM10_PUBLIC_HOST,
  ATM10_PUBLIC_PORT,
  autocompleteSavedServers,
  autocompleteStatusHosts,
  emptyListNote,
  listSavedStatusTargets,
  looksLikeAtm10Host,
  parseHostPort,
  resolveStatusSelection,
  staleNote
} = require('../src/craft/status-targets.cjs');

function storeOf({ panel = null, servers = [] } = {}) {
  return {
    getStatusPanel: () => panel,
    listPublicStatus: () => servers
  };
}

test('saved status targets prefer the panel and dedupe RCON by host and port', () => {
  const store = storeOf({
    panel: {
      host: 'play.khaosnexus.com',
      javaPort: 25614,
      bedrockPort: 19132,
      kind: 'geyser',
      rconName: 'skyblock'
    },
    servers: [
      { name: 'skyblock', host: 'play.khaosnexus.com', port: 25614 },
      { name: 'proxy', host: 'play.khaosnexus.com', port: 25614 },
      { name: 'other', host: 'mc.example.com', port: 25565 }
    ]
  });
  const targets = listSavedStatusTargets(store);
  assert.deepEqual(targets.map((target) => `${target.id}:${target.host}:${target.javaPort}`), [
    'skyblock:play.khaosnexus.com:25614',
    'other:mc.example.com:25565'
  ]);
  assert.equal(targets[0].kind, 'geyser');
  assert.equal(targets[0].source, 'status-panel');
  assert.equal(targets[1].source, 'rcon');
});

test('ATM10 join addresses are marked stale', () => {
  assert.equal(looksLikeAtm10Host(ATM10_PUBLIC_HOST, ATM10_PUBLIC_PORT), true);
  assert.equal(looksLikeAtm10Host('play.khaosnexus.com', 25614), false);
  const store = storeOf({
    panel: { host: ATM10_PUBLIC_HOST, javaPort: ATM10_PUBLIC_PORT, kind: 'java', rconName: 'atm10' }
  });
  const [target] = listSavedStatusTargets(store);
  assert.equal(target.stale, true);
  assert.match(staleNote(target), /ATM10/);
  assert.match(staleNote(target), /\/mc panel/);
});

test('resolveStatusSelection treats a blank host as all saved servers', () => {
  const store = storeOf({
    panel: { host: 'play.khaosnexus.com', javaPort: 25614, kind: 'java', rconName: 'skyblock' },
    servers: [{ name: 'other', host: 'mc.example.com', port: 25565 }]
  });
  const all = resolveStatusSelection('', store);
  assert.equal(all.mode, 'all');
  assert.equal(all.targets.length, 2);
  assert.equal(resolveStatusSelection('All servers', store).mode, 'all');
  assert.equal(resolveStatusSelection(ALL_SERVERS_VALUE, store).mode, 'all');

  const named = resolveStatusSelection('skyblock', store);
  assert.equal(named.mode, 'one');
  assert.equal(named.targets[0].host, 'play.khaosnexus.com');
  assert.equal(named.targets[0].javaPort, 25614);

  const raw = resolveStatusSelection('play.example.net:25588', store);
  assert.equal(raw.mode, 'raw');
  assert.equal(raw.targets[0].host, 'play.example.net');
  assert.equal(raw.targets[0].javaPort, 25588);
});

test('a missing saved list is explained clearly', () => {
  const empty = resolveStatusSelection('', storeOf());
  assert.equal(empty.mode, 'all');
  assert.equal(empty.targets.length, 0);
  assert.match(emptyListNote(), /No servers are saved/);
  assert.match(emptyListNote(), /\/mc panel/);
  assert.match(emptyListNote(), /\/mcrcon setup/);
});

test('parseHostPort accepts host, host:port, and bracketed IPv6', () => {
  assert.deepEqual(parseHostPort('play.khaosnexus.com', 25614), { host: 'play.khaosnexus.com', port: 25614 });
  assert.deepEqual(parseHostPort('127.0.0.1:25565'), { host: '127.0.0.1', port: 25565 });
  assert.deepEqual(parseHostPort('[::1]:25565'), { host: '::1', port: 25565 });
  assert.equal(parseHostPort('https://example.com'), null);
});

test('status autocomplete includes All servers and can omit it for panel host', () => {
  const store = storeOf({
    panel: { host: 'play.khaosnexus.com', javaPort: 25614, kind: 'java', rconName: 'skyblock' }
  });
  const status = autocompleteStatusHosts(store, '');
  assert.equal(status[0].name, 'All servers');
  assert.equal(status[0].value, ALL_SERVERS_VALUE);
  assert.equal(status[1].value, 'skyblock');
  assert.match(status[1].name, /play\.khaosnexus\.com:25614/);
  const panel = autocompleteStatusHosts(store, 'play', { includeAll: false, valueAsAddress: true });
  assert.equal(panel.some((choice) => choice.value === ALL_SERVERS_VALUE), false);
  assert.equal(panel[0].value, 'play.khaosnexus.com:25614');

  const servers = autocompleteSavedServers(storeOf({
    servers: [{ name: 'skyblock', host: 'play.khaosnexus.com', port: 25634 }]
  }), 'sky');
  assert.equal(servers[0].value, 'skyblock');
  assert.match(servers[0].name, /25634/);
});

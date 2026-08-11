'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

const MODULES = [
  {
    file: 'main/palworld-main-extension.cjs',
    action: 'palworld.server.mutation',
    map: 'MUTATION_CAPABILITIES',
    required: ['game.server.broadcast', 'game.server.save', 'game.player.moderate', 'game.player.ban', 'game.server.shutdown', 'game.server.stop']
  },
  {
    file: 'main/rust-main-extension.cjs',
    action: 'rust.server.mutation',
    map: 'RUST_MUTATION_CAPABILITIES',
    required: ['game.server.broadcast', 'game.server.save', 'game.player.moderate', 'game.player.ban', 'game.server.shutdown', 'game.server.stop', 'game.console.raw']
  },
  {
    file: 'main/satisfactory-main-extension.cjs',
    action: 'satisfactory.server.mutation',
    map: 'SATISFACTORY_MUTATION_CAPABILITIES',
    required: ['backup.create', 'game.server.save', 'game.server.shutdown', 'game.server.stop', 'game.console.raw']
  }
];

test('all live game mutation modules dispatch through Nexus Core', () => {
  for (const module of MODULES) {
    const source = read(module.file);
    assert.match(source, /getNexusCoreService/);
    assert.match(source, new RegExp(module.action.replaceAll('.', '\\.')));
    assert.match(source, /core\.commandGateway\.dispatch/);
    assert.match(source, new RegExp(module.map));
    for (const capability of module.required) assert.match(source, new RegExp(capability.replaceAll('.', '\\.')));
  }
});

test('owner-only direct shutdown, force-stop, ban, and raw console capabilities are absent from operator role', () => {
  const source = read('shared/nexus-core/capability-registry.cjs');
  const operatorBlock = source.match(/operator: Object\.freeze\(\[([\s\S]*?)\]\),\n  'community-manager'/)?.[1] || '';
  assert.doesNotMatch(operatorBlock, /game\.server\.shutdown/);
  assert.doesNotMatch(operatorBlock, /game\.server\.stop/);
  assert.doesNotMatch(operatorBlock, /game\.player\.ban/);
  assert.doesNotMatch(operatorBlock, /game\.console\.raw/);
  assert.match(operatorBlock, /game\.server\.restart/);
  assert.match(operatorBlock, /game\.player\.moderate/);
});

test('game adapter secrets are resolved inside executors rather than persisted in Core envelopes', () => {
  const palworld = read('main/palworld-main-extension.cjs');
  const rust = read('main/rust-main-extension.cjs');
  const satisfactory = read('main/satisfactory-main-extension.cjs');
  for (const source of [palworld, rust, satisfactory]) {
    assert.match(source, /explicitSecrets: \[server\.password\]/);
    assert.doesNotMatch(source, /input:\s*\{[^}]*password/s);
    assert.doesNotMatch(source, /idempotencyKey:\s*server\.password/);
  }
});

test('read-only game paths are not forced through the mutation gateway', () => {
  const palworld = read('main/palworld-main-extension.cjs');
  assert.match(palworld, /if \(!capability\) return executeAdapterAction/);
  const rust = read('main/rust-main-extension.cjs');
  assert.match(rust, /if \(!capability\) return executeRustAdapter/);
  const satisfactory = read('main/satisfactory-main-extension.cjs');
  assert.match(satisfactory, /if \(!capability\) return executeSatisfactoryAdapter/);
});

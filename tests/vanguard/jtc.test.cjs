'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { Events } = require('discord.js');
const {
  GAME_BOT_JTC_MODULES,
  OWNER_JTC_LOBBY_IDS,
  channelNameFor,
  installJoinToCreate,
  resolveJtcConfig
} = require('../../src/game-bots/join-to-create.cjs');
const { applyJtcLobby, installVanguardJtc, vanguardJtcConfig } = require('../../src/game-bots/vanguard/jtc.cjs');
const { Scheduler } = require('../../src/game-bots/vanguard/scheduler.cjs');

const LOBBY = '1541540961937526916';
const CATEGORY = '1516640233389822042';

test('vanguard join-to-create reuses the shared module and has no baked lobby', () => {
  assert.deepEqual(OWNER_JTC_LOBBY_IDS, {
    cephalon: '1540877236184424500',
    ascended: '1540867019979890829',
    sanctuary: '1541540961937526916'
  });
  assert.deepEqual(GAME_BOT_JTC_MODULES, ['ark', 'warframe', 'diablo4']);
  assert.equal(resolveJtcConfig('cephalon', {}).lobbyId, '1540877236184424500');

  const unset = vanguardJtcConfig({});
  assert.equal(unset.bot, 'vanguard');
  assert.equal(unset.lobbyId, '');
  assert.equal(unset.lobbySource, 'unset');
  assert.equal(unset.configured, false);

  const invalid = resolveJtcConfig('vanguard', { VANGUARD_JTC_LOBBY_CHANNEL_ID: 'nope', VANGUARD_DISCORD_CATEGORY_ID: CATEGORY });
  assert.equal(invalid.lobbySource, 'invalid');
  assert.equal(invalid.configured, false);

  const ready = vanguardJtcConfig({
    VANGUARD_JTC_LOBBY_CHANNEL_ID: LOBBY,
    VANGUARD_DISCORD_CATEGORY_ID: CATEGORY
  });
  assert.equal(ready.configured, true);
  assert.equal(ready.lobbyId, LOBBY);
  assert.equal(ready.categoryId, CATEGORY);
  assert.equal(ready.lobbySource, 'env');

  const name = channelNameFor('vanguard', 'Nova');
  assert.equal(name, "🎮 Nova's Fireteam");
  assert.doesNotMatch(name, /destiny|vanguard/i);
});

test('installing vanguard join-to-create listens once and can adopt a setup lobby', () => {
  const client = new EventEmitter();
  const env = { VANGUARD_DISCORD_CATEGORY_ID: CATEGORY };
  const first = installVanguardJtc(client, env);
  const second = installJoinToCreate(client, { bot: 'vanguard', env });
  assert.equal(first.controller.config.configured, false);
  assert.equal(second.controller, null);
  assert.equal(client.listeners(Events.VoiceStateUpdate).length, 1);

  env.VANGUARD_JTC_LOBBY_CHANNEL_ID = LOBBY;
  const updated = applyJtcLobby(first.controller, env);
  assert.equal(updated.configured, true);
  assert.equal(updated.lobbyId, LOBBY);
  assert.equal(first.controller.config.categoryId, CATEGORY);
});

test('the vanguard scheduler runs ready work and ticks one at a time', async () => {
  const scheduler = new Scheduler();
  const order = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const first = scheduler.run(async () => {
    order.push('start');
    await gate;
    order.push('end');
  });
  const second = scheduler.run(async () => {
    order.push('second');
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(order, ['start']);
  release();
  await first;
  await second;
  assert.deepEqual(order, ['start', 'end', 'second']);
  scheduler.stop();
  const skipped = await scheduler.run(async () => {
    order.push('late');
  });
  assert.equal(skipped.skipped, true);
  assert.deepEqual(order, ['start', 'end', 'second']);
});

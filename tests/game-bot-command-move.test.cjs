'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ASCENDED_COMMANDS, CEPHALON_COMMANDS, commandOwner, sentinalShouldRegister } = require('../src/sentinel/game-command-ownership.cjs');
const { applyGameBotDiscordEnv } = require('../src/game-bots/discord-env.cjs');
const { createGameBotHealthServer } = require('../src/game-bots/health.cjs');
const { ArkRconConfigStore } = require('../src/sentinel/ark-rcon-config-store.cjs');
const { warframeCommands } = require('../src/sentinel/cephalon-bot.cjs');

const root = path.resolve(__dirname, '..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');

test('ARK and Warframe slash commands have a single owner', () => {
  assert.deepEqual(ASCENDED_COMMANDS.filter((name) => commandOwner(name) !== 'ascended'), []);
  assert.deepEqual(CEPHALON_COMMANDS.filter((name) => commandOwner(name) !== 'cephalon'), []);
  assert.equal(sentinalShouldRegister('nexus'), true);
  assert.equal(sentinalShouldRegister('walletadjust'), true);
  assert.equal(sentinalShouldRegister('market'), false);
  assert.equal(sentinalShouldRegister('arkrcon'), false);
  assert.equal(new Set([...ASCENDED_COMMANDS, ...CEPHALON_COMMANDS]).size, ASCENDED_COMMANDS.length + CEPHALON_COMMANDS.length);
});

test('Sentinal entry no longer installs moved ARK command modules', () => {
  const entry = read('src/sentinel/entry.cjs');
  const ascended = read('src/sentinel/ascended-runtime.cjs');
  assert.doesNotMatch(entry, /installArkOpsExtension\(/);
  assert.doesNotMatch(entry, /ark-command-routing-patch/);
  assert.doesNotMatch(entry, /installDinoCacheRuntime\(/);
  assert.match(ascended, /installArkOpsExtension\(/);
  assert.match(ascended, /ark-command-routing-patch/);
  assert.match(ascended, /installDinoCacheRuntime\(/);
  assert.match(read('src/sentinel/bot.cjs'), /sentinalShouldRegister/);
});

test('Cephalon registers market and warframe only', () => {
  assert.deepEqual(warframeCommands().map((command) => command.name).sort(), ['market', 'warframe']);
});

test('game bot Discord env maps the guild id without inventing a token', () => {
  const env = { DISCORD_GUILD_ID: '123', DISCORD_BOT_TOKEN: 'token-value', READY: 'false' };
  const identity = applyGameBotDiscordEnv(env);
  assert.equal(env.NEXUS_DISCORD_GUILD_ID, '123');
  assert.equal(identity.guildConfigured, true);
  assert.equal(identity.token, 'token-value');
  assert.equal(identity.readyFlag, 'false');
});

test('health stays down until Discord is ready', async () => {
  const state = { discordReady: false, service: 'cephalon-nexus', bot: 'Cephalon Nexus', gameRole: 'warframe' };
  const server = await createGameBotHealthServer({ port: 0, getState: () => state });
  const port = server.address().port;
  try {
    const starting = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(starting.status, 503);
    assert.equal((await starting.json()).ok, false);
    state.discordReady = true;
    const ready = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), {
      ok: true,
      service: 'cephalon-nexus',
      bot: 'Cephalon Nexus',
      gameRole: 'warframe',
      discordReady: true
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test('Ascended RCON resolution ignores Railway connection values and keeps the Discord override', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ascended-rcon-'));
  try {
    const store = new ArkRconConfigStore(dir);
    const env = {
      NEXUS_RCON_RAILWAY_ENV_FORBIDDEN: 'true',
      NEXUS_RCON_SOURCE: 'discord_override_store',
      ARK_GEN1_ENABLED: 'true',
      ARK_GEN1_HOST: '203.0.113.9',
      ARK_GEN1_RCON_PORT: '28015',
      ARK_GEN1_RCON_PASSWORD: 'ignored-secret',
      ARK_GEN1_NAME: 'Gen1'
    };
    const blocked = store.resolve('ARK_GEN1', env);
    assert.equal(blocked.host, '');
    assert.equal(blocked.port, 0);
    assert.equal(blocked.password, '');
    assert.equal(blocked.enabled, false);
    assert.equal(blocked.source, 'discord-override-required');
    assert.equal(store.status('ARK_GEN1', env).passwordSource, 'missing');

    store.setEndpoint('ARK_GEN1', { host: '192.0.2.20', port: 30100, actorId: 'owner' });
    store.setPassword('ARK_GEN1', 'from-discord', 'owner');
    const saved = store.resolve('ARK_GEN1', env);
    assert.equal(saved.host, '192.0.2.20');
    assert.equal(saved.port, 30100);
    assert.equal(saved.password, 'from-discord');
    assert.equal(saved.enabled, true);
    assert.equal(saved.source, 'discord-override');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

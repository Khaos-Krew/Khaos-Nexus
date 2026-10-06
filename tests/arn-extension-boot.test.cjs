'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

test('entry installs ARN hooks after the Client swap and before bot.cjs', () => {
  const entry = fs.readFileSync(path.join(__dirname, '../src/sentinel/entry.cjs'), 'utf8');
  const bot = fs.readFileSync(path.join(__dirname, '../src/sentinel/bot.cjs'), 'utf8');
  const shiny = fs.readFileSync(path.join(__dirname, '../src/sentinel/ark-shiny-config-runtime.cjs'), 'utf8');
  const mention = entry.lastIndexOf('installMentionResponseExtension()');
  const ensure = entry.lastIndexOf('ensureArnGuildMessages()');
  const intake = entry.lastIndexOf('installArnIntakeExtension()');
  const live = entry.lastIndexOf('installArnLiveBoardExtension()');
  const cache = entry.lastIndexOf('installArnCacheExtension()');
  const botRequire = entry.lastIndexOf("require('./bot.cjs')");
  assert.ok(mention > 0 && mention < ensure, 'Guild Messages for ARN is the last Client swap');
  assert.ok(ensure < intake && intake < live && live < cache && cache < botRequire);
  assert.equal(entry.split('installArnLiveBoardExtension()').length - 1, 1);
  assert.equal(entry.split('installArnIntakeExtension()').length - 1, 1);
  assert.doesNotMatch(shiny, /installArnLiveBoardExtension/);
  assert.match(bot.split('\n')[3], /const \{ Client,/);
});

test('preloaded ARN modules hook the post-swap Client once', async () => {
  const discord = require('discord.js');
  const { Events, GatewayIntentBits } = discord;
  const Original = discord.Client;
  const saved = {
    role: process.env.NEXUS_GAME_ROLE,
    mode: process.env.ARKSHOP_DB_MODE,
    file: process.env.ARN_DRY_RUN_FILE
  };
  process.env.ARKSHOP_DB_MODE = 'retired';
  process.env.ARN_DRY_RUN_FILE = path.join(os.tmpdir(), `arn-boot-${process.pid}.json`);
  delete process.env.NEXUS_GAME_ROLE;
  delete process.env.NEXUS_LEVEL_MESSAGE_CONTENT;
  delete process.env.NEXUS_ARK_CROSSCHAT_ENABLED;

  require('../src/sentinel/arn-live-board-extension.cjs');
  require('../src/sentinel/arn-intake-extension.cjs');
  require('../src/sentinel/arn-cache-extension.cjs');
  require('../src/sentinel/guild-members-intent-extension.cjs').installGuildMembersIntentExtension();
  require('../src/sentinel/community-intents-extension.cjs').installCommunityIntentsExtension();
  require('../src/sentinel/mention-response-extension.cjs').installMentionResponseExtension();

  const live = require('../src/sentinel/arn-live-board-extension.cjs');
  live.ensureArnGuildMessages();
  const Active = discord.Client;
  const inheritedLogin = Active.prototype.login;
  Active.prototype.login = async function arnBootStubLogin() {
    this.emit(Events.ClientReady, this);
    return 'stub';
  };
  const fired = [];
  const origOnce = Active.prototype.once;
  const origOn = Active.prototype.on;
  Active.prototype.once = function onceSpy(event, listener) {
    if (event !== Events.ClientReady) return origOnce.call(this, event, listener);
    return origOnce.call(this, event, function readySpy(...args) {
      fired.push(listener.name || 'anonymous');
      return listener.apply(this, args);
    });
  };
  Active.prototype.on = function onSpy(event, listener) {
    if (event !== Events.MessageCreate && event !== Events.InteractionCreate) return origOn.call(this, event, listener);
    return origOn.call(this, event, function eventSpy(...args) {
      fired.push(`${event}:${listener.name || 'anonymous'}`);
      return listener.apply(this, args);
    });
  };

  try {
    assert.notEqual(Active, Original);
    require('../src/sentinel/arn-intake-extension.cjs').installArnIntakeExtension();
    live.installArnLiveBoardExtension();
    require('../src/sentinel/arn-cache-extension.cjs').installArnCacheExtension();
    assert.equal(Active.prototype.login.name, 'nexusArnCacheLogin');
    assert.notEqual(Original.prototype.login.name, 'nexusArnCacheLogin');
    assert.notEqual(inheritedLogin.name, 'nexusArnCacheLogin');

    const client = new Active({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates] });
    assert.equal(client.options.intents.has(GatewayIntentBits.GuildMessages), true);
    assert.equal(client.options.intents.has(GatewayIntentBits.MessageContent), false);
    await client.login('stub');
    const messagesAfterFirst = client.listenerCount(Events.MessageCreate);
    const interactionsAfterFirst = client.listenerCount(Events.InteractionCreate);
    await client.login('stub');
    assert.equal(client.listenerCount(Events.MessageCreate), messagesAfterFirst);
    assert.equal(client.listenerCount(Events.InteractionCreate), interactionsAfterFirst);
    client.emit(Events.MessageCreate, { id: '1', channelId: '2' });
    client.emit(Events.InteractionCreate, {});
    const ready = fired.filter((name) => name.startsWith('nexusArn') && !name.includes(':'));
    assert.deepEqual(ready.sort(), ['nexusArnCacheReady', 'nexusArnIntakeReady', 'nexusArnLiveBoardReady']);
    assert.equal(fired.filter((name) => name === 'messageCreate:nexusArnLiveBoardMessage').length, 1);
    assert.equal(fired.filter((name) => name === 'interactionCreate:nexusArnCacheInteraction').length, 1);
  } finally {
    Active.prototype.once = origOnce;
    Active.prototype.on = origOn;
    discord.Client = Original;
    if (saved.role === undefined) delete process.env.NEXUS_GAME_ROLE;
    else process.env.NEXUS_GAME_ROLE = saved.role;
    if (saved.mode === undefined) delete process.env.ARKSHOP_DB_MODE;
    else process.env.ARKSHOP_DB_MODE = saved.mode;
    if (saved.file === undefined) delete process.env.ARN_DRY_RUN_FILE;
    else process.env.ARN_DRY_RUN_FILE = saved.file;
  }
});

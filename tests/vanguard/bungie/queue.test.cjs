'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Events } = require('discord.js');
const { installVanguard } = require('../../../src/game-bots/vanguard/entry.cjs');

const GUILD = '1516640233389822001';

function until(predicate, ms = 1500) {
  const start = Date.now();
  return new Promise((resolve) => {
    const timer = setInterval(() => {
      if (predicate()) {
        clearInterval(timer);
        resolve(true);
        return;
      }
      if (Date.now() - start > ms) {
        clearInterval(timer);
        resolve(false);
      }
    }, 10);
  });
}

test('/lfg replies while a Bungie tick is still in flight', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanguard-queue-'));
  const env = {
    VANGUARD_DATA_DIR: dir,
    NEXUS_DATA_DIR: dir,
    VANGUARD_GUILD_ID: GUILD,
    BUNGIE_API_KEY: 'test-key-do-not-log'
  };
  let release = () => {};
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  let fetches = 0;
  const client = new EventEmitter();
  client.user = { id: '111111111111111111' };
  client.channels = { fetch: async () => null };
  client.guilds = {
    fetch: async () => ({
      id: GUILD,
      commands: {
        fetch: async () => ({ find: () => null }),
        create: async () => ({})
      }
    })
  };
  const replies = [];
  const ctx = installVanguard(client, {
    env,
    fetch: async () => {
      fetches += 1;
      await gate;
      return {
        status: 200,
        headers: { get: () => 'application/json' },
        async text() {
          return JSON.stringify({ ErrorCode: 1, Response: { systems: {} }, ThrottleSeconds: 0 });
        }
      };
    }
  });
  try {
    const started = Date.now();
    client.emit(Events.ClientReady);
    assert.equal(await until(() => fetches > 0), true);
    const skipped = await ctx.bungieLoop.pass();
    assert.equal(skipped.skipped, true);
    client.emit(Events.InteractionCreate, {
      commandName: 'lfg',
      guildId: GUILD,
      user: { id: '42' },
      isAutocomplete: () => false,
      isChatInputCommand: () => true,
      isButton: () => false,
      options: { getSubcommand: () => 'list' },
      reply: async (body) => {
        replies.push({ at: Date.now(), body });
      }
    });
    assert.equal(await until(() => replies.length > 0), true);
    assert.match(replies[0].body.content, /No open fireteams/);
    assert.ok(replies[0].at - started < 1500, `lfg waited ${replies[0].at - started}ms`);
    assert.equal(fetches > 0, true);
  } finally {
    release();
    ctx.bungieLoop?.stop();
    ctx.scheduler.stop();
    clearTimeout(ctx.boardTimer);
    await new Promise((resolve) => setTimeout(resolve, 30));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

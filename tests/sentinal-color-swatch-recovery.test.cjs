'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findExistingSwatch,
  solidColorPng,
  applicationEmojiManager,
  isGeneratedGuildSwatch,
  removeGeneratedGuildSwatch,
  ensureColorSwatches
} = require('../src/sentinel/color-swatch-emojis.cjs');

test('finds an existing named color swatch emoji deterministically', () => {
  const emojis = [
    { id: '222222222222222222', name: 'color_crimson', animated: false },
    { id: '333333333333333333', name: 'other_emoji', animated: false }
  ];
  const found = findExistingSwatch({ label: 'Crimson', color: '#dc143c' }, emojis);
  assert.equal(found.id, '222222222222222222');
});

test('solidColorPng creates a valid PNG payload', () => {
  const png = solidColorPng('#dc143c', 32);
  assert.equal(Buffer.isBuffer(png), true);
  assert.deepEqual([...png.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  assert.ok(png.length > 70);
});

test('uses the Sentinal application emoji manager instead of guild emoji capacity', () => {
  const appManager = { fetch() {}, create() {} };
  const guild = { client: { application: { emojis: appManager } } };
  assert.equal(applicationEmojiManager(guild), appManager);
});

test('creates a missing application swatch and attaches it to a recovered color menu', async () => {
  const created = [];
  const appManager = {
    fetch: async () => new Map(),
    create: async (input) => {
      assert.ok(Buffer.isBuffer(input.attachment));
      created.push(input.name);
      return { id: '444444444444444444', name: input.name, animated: false };
    }
  };
  const guild = { client: { application: { emojis: appManager } } };
  const menu = {
    id: 'colors',
    kind: 'colors',
    name: 'Name Colors',
    title: 'Name Colors',
    options: [{ id: 'crimson', label: 'Crimson', roleId: '111111111111111111', color: '#dc143c' }]
  };
  const result = await ensureColorSwatches(menu, guild, { logger: { warn() {} } });
  assert.equal(result.created, 1);
  assert.equal(result.cleaned, 0);
  assert.equal(result.missing.length, 0);
  assert.equal(result.menu.options[0].emojiId, '444444444444444444');
  assert.equal(created[0], 'nexus_color_crimson');
});

test('replaces a temporary guild swatch with an application swatch and frees the guild slot', async () => {
  let deleted = 0;
  const guildEmoji = {
    id: '555555555555555555',
    name: 'nexus_color_cyan',
    delete: async () => { deleted += 1; }
  };
  const appManager = {
    fetch: async () => new Map([['666666666666666666', {
      id: '666666666666666666',
      name: 'nexus_color_cyan',
      animated: false
    }]]),
    create: async () => { throw new Error('should reuse existing application swatch'); }
  };
  const guild = {
    client: { application: { emojis: appManager } },
    emojis: { cache: new Map([[guildEmoji.id, guildEmoji]]) }
  };
  const menu = {
    id: 'colors',
    kind: 'colors',
    name: 'Name Colors',
    title: 'Name Colors',
    options: [{
      id: 'cyan',
      label: 'Cyan',
      roleId: '111111111111111111',
      color: '#00bcd4',
      emoji: { id: guildEmoji.id, name: guildEmoji.name }
    }]
  };

  assert.equal(isGeneratedGuildSwatch({ emojiId: guildEmoji.id, emoji: guildEmoji.name }), true);
  const result = await ensureColorSwatches(menu, guild, { logger: { warn() {} } });
  assert.equal(result.matched, 1);
  assert.equal(result.created, 0);
  assert.equal(result.cleaned, 1);
  assert.equal(result.missing.length, 0);
  assert.equal(result.menu.options[0].emojiId, '666666666666666666');
  assert.equal(deleted, 1);
});

test('does not send an application emoji id to guild deletion when no matching guild emoji exists', async () => {
  let deleteCalls = 0;
  const guild = {
    emojis: {
      cache: new Map(),
      fetch: async () => { throw new Error('Unknown Emoji'); },
      delete: async () => { deleteCalls += 1; }
    }
  };
  const removed = await removeGeneratedGuildSwatch({
    label: 'Cyan',
    emojiId: '666666666666666666',
    emoji: 'nexus_color_cyan'
  }, guild, { warn() {} });
  assert.equal(removed, false);
  assert.equal(deleteCalls, 0);
});

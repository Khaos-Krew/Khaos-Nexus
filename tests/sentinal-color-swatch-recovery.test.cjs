'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  findExistingSwatch,
  solidColorPng,
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

test('creates a missing swatch and attaches it to a recovered color menu', async () => {
  const created = [];
  const guild = {
    emojis: {
      fetch: async () => new Map(),
      create: async (input) => {
        assert.ok(Buffer.isBuffer(input.attachment));
        created.push(input.name);
        return { id: '444444444444444444', name: input.name, animated: false };
      }
    }
  };
  const menu = {
    id: 'colors',
    kind: 'colors',
    name: 'Name Colors',
    title: 'Name Colors',
    options: [{ id: 'crimson', label: 'Crimson', roleId: '111111111111111111', color: '#dc143c' }]
  };
  const result = await ensureColorSwatches(menu, guild, { logger: { warn() {} } });
  assert.equal(result.created, 1);
  assert.equal(result.missing.length, 0);
  assert.equal(result.menu.options[0].emojiId, '444444444444444444');
  assert.equal(created[0], 'nexus_color_crimson');
});

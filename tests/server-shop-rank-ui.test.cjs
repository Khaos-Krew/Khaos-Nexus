'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'rank-discovery-ui.js'), 'utf8');

test('rank discovery UI presents Discord Server Shop authority without Premium App SKU blockers', () => {
  assert.match(source, /server-shop-managed/);
  assert.match(source, /Paid access: Server Shop managed/);
  assert.match(source, /Premium App SKU mappings are not required/);
  assert.match(source, /Sync free rank baseline/);
  assert.match(source, /discovery\.authority === 'server-shop-roles'/);
});

test('Server Shop discovery does not fill Premium App SKU fields', () => {
  assert.match(source, /!serverShop && skuInput/);
  assert.match(source, /Server Shop paid ranks do not require Premium App SKU IDs/);
});

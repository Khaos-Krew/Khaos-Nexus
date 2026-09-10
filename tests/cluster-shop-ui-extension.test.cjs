'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  PANEL_MARKER,
  normalizeChannelName,
  buildClusterShopPanelPayload,
  uniqueCategories,
  linkedEos
} = require('../src/sentinel/cluster-shop-ui-extension.cjs');

test('cluster shop panel exposes buy sell wallet and help actions', () => {
  const payload = buildClusterShopPanelPayload();
  assert.equal(payload.embeds.length, 1);
  const embed = payload.embeds[0].toJSON();
  assert.equal(embed.footer.text, PANEL_MARKER);
  assert.match(embed.title, /CLUSTER SHOP/);
  assert.match(embed.description, /Dinos are never sellable/);
  const ids = payload.components.flatMap((row) => row.components.map((component) => component.data.custom_id));
  assert.deepEqual(ids, ['nexus-shop:buy', 'nexus-shop:sell', 'nexus-shop:wallet', 'nexus-shop:help']);
});

test('cluster shop channel matching ignores punctuation', () => {
  assert.equal(normalizeChannelName('cluster-shop'), 'clustershop');
  assert.equal(normalizeChannelName('Cluster Shop'), 'clustershop');
});

test('catalog category lists respect buyable and sellable flags', () => {
  const items = [
    { category: 'Resources', buyable: true, sellable: true },
    { category: 'Resources', buyable: true, sellable: false },
    { category: 'Gear', buyable: true, sellable: false },
    { category: 'Tributes', buyable: false, sellable: true }
  ];
  assert.deepEqual(uniqueCategories(items, 'buy'), ['Gear', 'Resources']);
  assert.deepEqual(uniqueCategories(items, 'sell'), ['Resources', 'Tributes']);
});

test('linkedEos reads the existing verified ARK identity profile', () => {
  const identityStore = {
    read() {
      return {
        profiles: {
          '123': {
            arkAccounts: [{ eosId: 'EOS_ABC' }]
          }
        }
      };
    }
  };
  assert.equal(linkedEos(identityStore, '123'), 'EOS_ABC');
  assert.equal(linkedEos(identityStore, 'missing'), '');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { ArkShopProfileStore } = require('../src/sentinel/arkshop-profiles.cjs');
const { renderPublicShopReply, renderPublicKitsReply } = require('../src/sentinel/arkshop-public-view.cjs');

function storeWithProfile() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-arkshop-public-'));
  const store = new ArkShopProfileStore(root);
  store.create({
    id: 'arkshop-live',
    name: 'Live',
    data: {
      managedSections: ['ShopItems', 'Kits'],
      ShopItems: {
        metal: { Type: 'item', Description: 'Metal Bundle', Price: 50 },
        rex: { Type: 'dino', Description: 'Rex', Price: 1000 }
      },
      Kits: {
        starter: { Description: 'Starter Kit', Price: 90, DefaultAmount: 2, OnlyFromSpawn: true }
      }
    }
  });
  return store;
}

test('public shop view exposes useful listing data but no profile or database internals', () => {
  const store = storeWithProfile();
  const servers = [{ id: 'gen1', mapName: 'Genesis Part 1', enabled: true, shopEnabled: true, shopProfile: 'arkshop-live' }];
  const reply = renderPublicShopReply(servers, store);
  assert.match(reply, /Genesis Part 1/);
  assert.match(reply, /Metal Bundle/);
  assert.match(reply, /50 pts/);
  assert.match(reply, /Rex/);
  assert.match(reply, /1000 pts/);
  assert.doesNotMatch(reply, /arkshop-live|Mysql|RCON|SFTP|password/i);
});

test('public kit view exposes safe kit name price and availability hints', () => {
  const store = storeWithProfile();
  const servers = [{ id: 'gen1', mapName: 'Genesis Part 1', enabled: true, kitsEnabled: true, shopProfile: 'arkshop-live' }];
  const reply = renderPublicKitsReply(servers, store);
  assert.match(reply, /Starter Kit/);
  assert.match(reply, /90 pts/);
  assert.match(reply, /2 starting uses/);
  assert.match(reply, /spawn only/);
  assert.doesNotMatch(reply, /arkshop-live|Mysql|credential|webhook/i);
});

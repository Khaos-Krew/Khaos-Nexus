'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { DatabaseSync } = require('node:sqlite');
const { createManifest, unzipSqlite } = require('../../../src/game-bots/vanguard/bungie/manifest.cjs');
const { createManifestQuery, hashKeys } = require('../../../src/game-bots/vanguard/bungie/manifest-query.cjs');
const { createActivityCatalog } = require('../../../src/game-bots/vanguard/lfg/activities-manifest.cjs');
const { nextResetAt } = require('../../../src/game-bots/vanguard/bungie/time.cjs');
const { renderWeeklyReset } = require('../../../src/game-bots/vanguard/panels/weekly-reset.cjs');
const { XUR_VENDOR_HASH, locationFromVendors, renderXur } = require('../../../src/game-bots/vanguard/panels/xur.cjs');
const { lookupSaleItems } = require('../../../src/game-bots/vanguard/commands/d2-xur.cjs');
const { featureOpen } = require('../../../src/game-bots/vanguard/bungie/health.cjs');

function sqliteBytes() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'vanguard-manifest-src-')), 'world.sqlite3');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE DestinyMilestoneDefinition (id INTEGER PRIMARY KEY, json TEXT)');
  db.exec('CREATE TABLE DestinyInventoryItemDefinition (id INTEGER PRIMARY KEY, json TEXT)');
  db.exec('CREATE TABLE DestinyActivityModeDefinition (id INTEGER PRIMARY KEY, json TEXT)');
  db.exec('CREATE TABLE DestinyActivityDefinition (id INTEGER PRIMARY KEY, json TEXT)');
  const insert = (table, hash, json) => {
    db.prepare(`INSERT INTO ${table} (id, json) VALUES (?, ?)`).run(hashKeys(hash)[0], JSON.stringify(json));
  };
  insert('DestinyMilestoneDefinition', 10, { hash: 10, displayProperties: { name: 'Weekly Clan Engrams' } });
  insert('DestinyActivityModeDefinition', 4, { hash: 4, modeType: 4, displayProperties: { name: 'Raid' } });
  insert('DestinyActivityDefinition', 77, { hash: 77, directActivityModeType: 4, displayProperties: { name: 'Vault of Glass' } });
  insert('DestinyInventoryItemDefinition', 99, {
    hash: 99,
    itemType: 3,
    displayProperties: { name: 'Young Ahamkara\'s Spine' },
    inventory: { tierType: 6, tierTypeName: 'Exotic', bucketTypeHash: 1498876634 }
  });
  insert('DestinyInventoryItemDefinition', 7, { hash: 7, itemType: 0, displayProperties: { name: 'Exotic Gear' } });
  db.close();
  return fs.readFileSync(file);
}

function zipWrap(name, data, method) {
  const stored = method === 8 ? zlib.deflateRawSync(data) : data;
  const nameBuf = Buffer.from(name);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(8, 8);
  header.writeUInt32LE(stored.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(nameBuf.length, 26);
  return Buffer.concat([header, nameBuf, stored]);
}

test('manifest download validates, swaps once, and keeps the previous version', async () => {
  const bytes = sqliteBytes();
  assert.equal(unzipSqlite(zipWrap('world.sqlite3', bytes, 8)).subarray(0, 15).toString('utf8'), 'SQLite format 3');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanguard-manifest-'));
  const manifest = createManifest({ dir, now: () => new Date('2026-10-01T22:00:00Z') });
  let downloads = 0;
  const version = { current: '2026.10.01.1' };
  const client = {
    async get() {
      return {
        ok: true,
        json: { Response: { version: version.current, mobileWorldContentPaths: { en: '/common/destiny2_content/sqlite/en/world.content' } } }
      };
    },
    async download() {
      downloads += 1;
      const body = version.current.endsWith('.1') ? bytes : sqliteBytes();
      return { ok: true, response: { arrayBuffer: async () => body } };
    }
  };
  const first = await manifest.ensure(client);
  assert.equal(first.ok, true);
  assert.equal(first.downloaded, true);
  assert.equal(downloads, 1);
  const again = await manifest.ensure(client);
  assert.equal(again.downloaded, false);
  assert.equal(downloads, 1);
  const previous = first.path;
  version.current = '2026.10.08.2';
  const next = await manifest.ensure(client);
  assert.equal(next.downloaded, true);
  assert.equal(next.kept, previous);
  assert.equal(fs.existsSync(previous), true);
  assert.equal(fs.existsSync(next.path), true);
  const query = createManifestQuery();
  query.open(next.path);
  assert.equal(query.nameFor('DestinyMilestoneDefinition', 10), 'Weekly Clan Engrams');
  const exotic = query.itemMeta('DestinyInventoryItemDefinition', 99);
  assert.equal(exotic.itemType, 3);
  assert.equal(exotic.tierType, 6);
  assert.equal(exotic.bucketTypeHash, 1498876634);
  const sales = lookupSaleItems(query, [99, 7]);
  assert.equal(sales.get('99').tierTypeName, 'Exotic');
  assert.equal(sales.get('7').itemType, 0);
  const catalog = createActivityCatalog({ query });
  assert.equal(catalog.find('raid').label, 'Raid');
  const found = catalog.search('vault');
  assert.equal(found[0].name, 'Vault of Glass');
  assert.match(found[0].value, /^a:77$/);
  query.close();
});

test('weekly reset time comes from milestone dates and says when the list is short', () => {
  const source = fs.readFileSync(path.join(__dirname, '../../../src/game-bots/vanguard/panels/weekly-reset.cjs'), 'utf8');
  assert.doesNotMatch(source, /17:00/);
  const now = Date.parse('2026-10-01T18:00:00Z');
  const milestones = {
    Response: {
      10: { milestoneHash: 10, startDate: '2026-09-29T17:00:00Z', endDate: '2026-10-06T17:00:00Z' },
      11: { milestoneHash: 11 }
    }
  };
  const embed = renderWeeklyReset({
    milestones,
    names: new Map([['10', 'Weekly Clan Engrams']]),
    now
  });
  const resetUnix = Math.floor(Date.parse('2026-10-06T17:00:00Z') / 1000);
  assert.equal(nextResetAt(milestones.Response, now), Date.parse('2026-10-06T17:00:00Z'));
  assert.doesNotMatch(embed.description, /LIMITED/);
  assert.doesNotMatch(embed.description, /Milestone /);
  assert.match(embed.description, /Few public milestones/);
  assert.match(embed.description, new RegExp(`⏳ Next reset <t:${resetUnix}:R>`));
  assert.doesNotMatch(embed.description, /17:00 UTC/);
  const rewards = embed.fields.find((field) => field.name.includes('Rewards'));
  assert.match(rewards.value, /Weekly Clan Engrams/);
  assert.doesNotMatch(rewards.value, /<t:/);
  assert.equal(embed.fields.find((field) => field.name.includes('Nightfall')), undefined);
  assert.equal(embed.fields.find((field) => field.name.includes('Raid')), undefined);
  assert.equal(embed.fields.some((field) => field.value === 'None'), false);
  assert.ok(embed.fields.length <= 25);
  for (const field of embed.fields) {
    assert.equal(field.inline, false);
    assert.ok(field.value.length <= 1024);
  }
  assert.ok(embed.description.split('\n').length <= 4);
  const none = renderWeeklyReset({ milestones: { Response: {} }, now });
  assert.match(none.description, /No public milestones/);
});

test('weekly lines stay names only, with one countdown for the soonest reset', () => {
  const now = Date.parse('2026-10-01T18:00:00Z');
  const resetUnix = Math.floor(Date.parse('2026-10-06T17:00:00Z') / 1000);
  const activityUnix = Math.floor(Date.parse('2026-10-05T17:00:00Z') / 1000);
  const purification = renderWeeklyReset({
    milestones: {
      Response: {
        10: { milestoneHash: 10, endDate: '2026-10-06T17:00:00Z' },
        12: { milestoneHash: 12 }
      }
    },
    names: new Map([['10', 'Weekly Clan Engrams'], ['12', 'Purification']]),
    now
  });
  const week = purification.fields.find((field) => field.name.includes('This Week'));
  assert.equal(week.value, 'Purification');
  assert.doesNotMatch(week.value, /<t:/);
  assert.match(purification.description, new RegExp(`⏳ Next reset <t:${resetUnix}:R>`));
  const raidWeek = renderWeeklyReset({
    milestones: {
      Response: {
        10: { milestoneHash: 10, endDate: '2026-10-06T17:00:00Z' },
        13: { milestoneHash: 13, activities: [{ endDate: '2026-10-05T17:00:00Z' }] }
      }
    },
    names: new Map([['10', 'Weekly Clan Engrams'], ['13', 'Featured Dungeon']]),
    now
  });
  const raid = raidWeek.fields.find((field) => field.name.includes('Raid'));
  const rewards = raidWeek.fields.find((field) => field.name.includes('Rewards'));
  assert.equal(raid.value, 'Featured Dungeon');
  assert.equal(rewards.value, 'Weekly Clan Engrams');
  assert.doesNotMatch(JSON.stringify(raidWeek.fields), /<t:/);
  assert.match(raidWeek.description, new RegExp(`⏳ Next reset <t:${activityUnix}:R>`));
  assert.equal((raidWeek.description.match(/<t:/g) || []).length, 1);
});

test('xur is absent outside his window and the panel leaves location out', () => {
  const absent = renderXur({ vendors: { Response: { vendors: { data: {} } } } });
  assert.equal(absent.present, false);
  assert.match(absent.description, /Xûr is not here/);
  assert.doesNotMatch(absent.description, /location|Last City|Tower/i);
  const later = Date.parse('2026-10-03T18:00:00Z');
  const gone = renderXur({
    vendors: {
      Response: {
        vendors: { data: { [XUR_VENDOR_HASH]: { vendorHash: XUR_VENDOR_HASH, enabled: true, nextRefreshDate: '2026-10-02T09:00:00Z' } } }
      }
    },
    now: later
  });
  assert.equal(gone.present, false);
  const here = renderXur({
    vendors: {
      Response: {
        vendors: { data: { [String(XUR_VENDOR_HASH)]: { vendorHash: XUR_VENDOR_HASH, enabled: true, nextRefreshDate: '2026-10-02T09:00:00Z' } } },
        sales: { data: { [String(XUR_VENDOR_HASH)]: { saleItems: { 1: { itemHash: 99, costs: [{ itemHash: 50, quantity: 41 }] } } } } }
      }
    },
    names: new Map([['99', 'Young Ahamkara\'s Spine'], ['50', 'Strange Coin']]),
    now: Date.parse('2026-10-01T22:00:00Z')
  });
  assert.equal(here.present, true);
  const other = here.fields.find((field) => field.name.includes('Other'));
  assert.match(other.value, /Young Ahamkara's Spine — 41 Strange Coin/);
  assert.equal(here.fields.find((field) => field.name.includes('Exotics')), undefined);
  assert.equal(here.fields.find((field) => field.name.includes('Legendaries')), undefined);
  assert.equal(here.fields.every((field) => field.inline === false), true);
  assert.doesNotMatch(here.description, /📍 Location|not listed|Last City|Tower/i);
  const placedVendors = {
    Response: {
      vendors: { data: { [String(XUR_VENDOR_HASH)]: { vendorHash: XUR_VENDOR_HASH, enabled: true, nextRefreshDate: '2026-10-02T09:00:00Z', location: 'European Dead Zone' } } }
    }
  };
  assert.equal(locationFromVendors(placedVendors), 'European Dead Zone');
  const placed = renderXur({ vendors: placedVendors, now: Date.parse('2026-10-01T22:00:00Z') });
  assert.match(placed.description, /📍 Location: European Dead Zone/);
  assert.doesNotMatch(placed.description, /not listed|Last City|Tower/i);
  const leaves = Math.floor(Date.parse('2026-10-02T09:00:00Z') / 1000);
  assert.match(here.description, new RegExp(`⏳ Leaves <t:${leaves}:R>`));
  const returns = Math.floor(Date.parse('2026-10-09T17:00:00Z') / 1000);
  assert.match(gone.description, /Xûr is not here/);
  assert.match(gone.description, new RegExp(`⏳ Returns <t:${returns}:R>`));
  assert.doesNotMatch(gone.description, /Last City|Tower/i);
  assert.equal(featureOpen({ D2PublicMilestones: false, D2Milestones: true }, 'reset'), true);
  assert.equal(featureOpen({ D2Vendors: false }, 'xur'), false);
  assert.equal(featureOpen({ Destiny2: true, D2Profiles: true }, 'lookup'), true);
  assert.equal(featureOpen({ Destiny2: true }, 'clan'), false);
});

test('xur drops category headings and groups real items by tier', () => {
  const embed = renderXur({
    vendors: {
      Response: {
        vendors: { data: { [String(XUR_VENDOR_HASH)]: { vendorHash: XUR_VENDOR_HASH, enabled: true, nextRefreshDate: '2026-10-02T09:00:00Z' } } },
        sales: {
          data: {
            [String(XUR_VENDOR_HASH)]: {
              saleItems: {
                1: { itemHash: 7 },
                2: { itemHash: 20 },
                3: { itemHash: 21 },
                4: { itemHash: 99, costs: [{ itemHash: 50, quantity: 41 }] },
                5: { itemHash: 88, costs: [{ itemHash: 50, quantity: 23 }] },
                6: { itemHash: 77 },
                7: { itemHash: 22 }
              }
            }
          }
        }
      }
    },
    names: new Map([
      ['7', { name: 'Exotic Gear', itemType: 0, tierType: 0, bucketTypeHash: 0 }],
      ['20', { name: 'Dummy Category', itemType: 20, tierType: 6, bucketTypeHash: 1498876634 }],
      ['21', { name: 'Featured', itemType: 3, tierType: 6, tierTypeName: 'Exotic', bucketTypeHash: 1498876634, displayCategory: true }],
      ['22', { name: 'Redacted Exotic', itemType: 3, tierType: 6, bucketTypeHash: 1498876634, redacted: true }],
      ['99', { name: 'Young Ahamkara\'s Spine', itemType: 3, tierType: 6, tierTypeName: 'Exotic', bucketTypeHash: 1498876634 }],
      ['88', { name: 'Palindrome', itemType: 3, tierType: 5, tierTypeName: 'Legendary', bucketTypeHash: 1498876634 }],
      ['77', { name: 'Strange Coin Bundle', itemType: 9, tierType: 3, bucketTypeHash: 1469714392 }],
      ['50', { name: 'Strange Coin', itemType: 1, tierType: 3, bucketTypeHash: 1469714392 }]
    ]),
    now: Date.parse('2026-10-01T22:00:00Z'),
    location: 'European Dead Zone'
  });
  const text = JSON.stringify(embed);
  assert.doesNotMatch(text, /Exotic Gear|Dummy Category|Featured|Redacted Exotic/);
  assert.match(embed.fields.find((field) => field.name.includes('Exotics')).value, /Young Ahamkara's Spine — 41 Strange Coin/);
  assert.match(embed.fields.find((field) => field.name.includes('Legendaries')).value, /Palindrome — 23 Strange Coin/);
  assert.match(embed.fields.find((field) => field.name.includes('Other')).value, /Strange Coin Bundle/);
  assert.match(embed.description, /📍 Location: European Dead Zone/);
  assert.doesNotMatch(embed.description, /Last City|Tower/i);
  assert.ok(embed.description.split('\n').length <= 4);
  assert.equal(embed.fields.length, 3);
  assert.equal(embed.fields.every((field) => field.inline === false), true);
});

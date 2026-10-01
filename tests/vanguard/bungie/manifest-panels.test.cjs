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
const { XUR_VENDOR_HASH, renderXur } = require('../../../src/game-bots/vanguard/panels/xur.cjs');
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
  insert('DestinyInventoryItemDefinition', 99, { hash: 99, displayProperties: { name: 'Young Ahamkara\'s Spine' }, inventory: { tierType: 6, tierTypeName: 'Exotic' } });
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
  assert.equal(nextResetAt(milestones.Response, now), Date.parse('2026-10-06T17:00:00Z'));
  assert.match(embed.description, /LIMITED/);
  assert.match(embed.description, /Few public milestones/);
  assert.match(embed.description, /Weekly Clan Engrams/);
  assert.match(embed.description, /Next reset: Oct 6, 2026, 12:00 PM CT/);
  assert.doesNotMatch(embed.description, /17:00 UTC/);
  const none = renderWeeklyReset({ milestones: { Response: {} }, now });
  assert.match(none.description, /No public milestones/);
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
  assert.match(here.description, /Young Ahamkara's Spine — 41 Strange Coin/);
  assert.doesNotMatch(here.description, /location|Last City|Tower/i);
  assert.equal(featureOpen({ D2PublicMilestones: false, D2Milestones: true }, 'reset'), true);
  assert.equal(featureOpen({ D2Vendors: false }, 'xur'), false);
  assert.equal(featureOpen({ Destiny2: true, D2Profiles: true }, 'lookup'), true);
  assert.equal(featureOpen({ Destiny2: true }, 'clan'), false);
});

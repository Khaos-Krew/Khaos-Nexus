'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { brandEmbed, BOT_STYLE, MOTTO, layoutFields } = require('../src/shared/embed-style.cjs');
const { parseClanMarker } = require('../src/game-bots/cephalon-relay.cjs');
const { PANELS, refreshWarframePanels } = require('../src/game-bots/cephalon-warframe-panels.cjs');
const { upsertEmbed } = require('../src/game-bots/panel-message.cjs');
const { OWNER_CATEGORY_IDS } = require('../src/game-bots/category-gate.cjs');
const { fissureEmbed } = require('../src/game-bots/cephalon-relay.cjs');

const BRAND_DIR = path.join(__dirname, '../src/shared/brand-assets');
const CHANNEL_ID = '1516640233389822111';
const BOT_ID = '111111111111111111';

function pngSize(bytes) {
  assert.equal(bytes.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(bytes.toString('ascii', 12, 16), 'IHDR');
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

test('brand-assets PNGs match the manifest and stay PNG', () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(BRAND_DIR, 'MANIFEST.json'), 'utf8'));
  const names = fs.readdirSync(BRAND_DIR).filter((name) => !name.startsWith('.'));
  for (const name of names) {
    assert.equal(/\.(webp|jpe?g)$/i.test(name), false, name);
  }
  assert.equal(manifest.files.length, 2);
  for (const entry of manifest.files) {
    const bytes = fs.readFileSync(path.join(BRAND_DIR, entry.file));
    assert.equal(bytes.length, entry.bytes);
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), entry.sha256);
    const size = pngSize(bytes);
    assert.deepEqual([size.width, size.height], entry.size);
  }
});

test('brandEmbed uses the motto, cephalon color, and three inline fields per row', () => {
  assert.equal(MOTTO, 'Many Worlds One Nexus');
  assert.equal(BOT_STYLE.cephalon.color, 0x00B4D8);
  assert.equal(BOT_STYLE.sentinal.iconFile, null);
  assert.equal(BOT_STYLE.cephalon.bannerFile, 'cephalon-panel-banner.png');
  const branded = brandEmbed('cephalon', {
    title: "💎 Baro Ki'Teer",
    description: '📍 Orcus Relay\n⏳ Leaves soon\n-# Data: WarframeStat',
    footerKey: 'baro',
    avatarUrl: 'https://cdn.example/avatar.png',
    banner: 'none',
    thumbnail: 'icon',
    fields: [
      { name: 'One', value: 'a', inline: true },
      { name: 'Two', value: 'b', inline: true },
      { name: 'Three', value: 'c', inline: true },
      { name: 'Four', value: 'd', inline: true }
    ]
  });
  assert.equal(branded.embed.footer.text, 'Many Worlds One Nexus • baro');
  assert.equal(branded.embed.footer.icon_url, 'https://cdn.example/avatar.png');
  assert.equal(branded.embed.author.name, 'Cephalon Nexus');
  assert.equal(branded.embed.color, 0x00B4D8);
  assert.equal(branded.embed.image, undefined);
  assert.equal(branded.embed.thumbnail.url, 'attachment://icon-cephalon.png');
  assert.equal(branded.files[0].name, 'icon-cephalon.png');
  assert.deepEqual(branded.embed.fields.map((field) => field.inline), [true, true, true, false]);
  const overflow = layoutFields(Array.from({ length: 8 }, (_, index) => ({ name: `F${index}`, value: 'x', inline: true })));
  assert.equal(overflow.length, 6);
  assert.match(overflow[5].value, /\+3 more/);
});

test('an edit keeps a same-name attachment instead of uploading it again', async () => {
  const edited = [];
  const existing = {
    id: '333333333333333333',
    author: { id: BOT_ID, bot: true },
    embeds: [{ title: '🔶 Fissures', footer: { text: 'Many Worlds One Nexus • fissures' } }],
    attachments: [{ id: '4242', name: 'cephalon-panel-banner.png' }],
    edit: async (body) => { edited.push(body); }
  };
  const channel = {
    id: CHANNEL_ID,
    send: async () => { throw new Error('existing attachment should be edited'); },
    messages: { fetch: async () => existing }
  };
  const panel = fissureEmbed([{ tier: 'Lith', node: 'Lith, Earth', mission: 'Capture', eta: '12m' }], { banner: 'auto' });
  const result = await upsertEmbed({ user: { id: BOT_ID }, channels: { fetch: async () => channel } }, CHANNEL_ID, existing.id, {
    embeds: [panel]
  }, { panel: 'fissures', botId: BOT_ID });
  assert.equal(result.edited, true);
  assert.equal(result.created, false);
  assert.deepEqual(edited[0].attachments, [{ id: '4242' }]);
  assert.equal((edited[0].files || []).some((file) => file.name === 'cephalon-panel-banner.png'), false);
});

function worldChannel() {
  const sent = [];
  const edited = [];
  const list = [];
  return {
    sent,
    edited,
    channel: {
      id: CHANNEL_ID,
      name: 'warframe-world-state',
      parentId: OWNER_CATEGORY_IDS.cephalon,
      send: async (body) => {
        const created = {
          id: `81${String(list.length + 1).padStart(16, '0')}`,
          author: { id: BOT_ID, bot: true },
          embeds: body.embeds,
          attachments: (body.files || []).map((file, index) => ({ id: String(index + 1), name: file.name })),
          edit: async (next) => { edited.push(next); created.embeds = next.embeds; },
          delete: async () => {}
        };
        sent.push(body);
        list.push(created);
        return created;
      },
      messages: {
        fetch: async (arg) => {
          if (arg && typeof arg === 'object') return { values: () => list.values() };
          return list.find((item) => item.id === String(arg)) || null;
        }
      }
    }
  };
}

test('legacy and new footers edit in place and a shared channel has one banner', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'embed-phase1-'));
  const legacyId = '444444444444444444';
  fs.writeFileSync(path.join(dir, 'cephalon-warframe-panels.json'), JSON.stringify({
    version: 1,
    panels: { events: { channelId: CHANNEL_ID, messageId: legacyId } }
  }));
  const edited = [];
  const sent = [];
  const legacy = {
    id: legacyId,
    author: { id: BOT_ID, bot: true },
    embeds: [{ title: 'Cephalon • Warframe Events', footer: { text: 'Cephalon Nexus • warframe:events' } }],
    edit: async (body) => { edited.push(body); this.embeds = body.embeds; }
  };
  const list = [legacy];
  const channel = {
    id: CHANNEL_ID,
    name: 'warframe-world-state',
    parentId: OWNER_CATEGORY_IDS.cephalon,
    send: async (body) => {
      sent.push(body);
      const created = {
        id: `82${String(list.length).padStart(16, '0')}`,
        author: { id: BOT_ID, bot: true },
        embeds: body.embeds,
        edit: async () => {},
        delete: async () => {}
      };
      list.push(created);
      return created;
    },
    messages: {
      fetch: async (arg) => {
        if (arg && typeof arg === 'object') return { values: () => list.values() };
        return list.find((item) => item.id === String(arg)) || null;
      }
    }
  };
  const provider = { worldstate: async () => ({ description: 'Double affinity', node: 'Earth', eta: '1d' }) };
  const client = { user: { id: BOT_ID }, channels: { fetch: async () => channel } };
  const env = { NEXUS_DATA_DIR: dir, CEPHALON_WARFRAME_EVENTS_CHANNEL_ID: CHANNEL_ID };
  try {
    const first = await refreshWarframePanels({ client, env, provider, dir });
    assert.equal(first.refreshed, 1);
    assert.equal(sent.length, 0);
    assert.equal(edited.length, 1);
    assert.equal(edited[0].embeds[0].footer.text, 'Many Worlds One Nexus • events');

    const again = await refreshWarframePanels({ client, env, provider, dir });
    assert.equal(again.refreshed, 1);
    assert.equal(sent.length, 0);
    assert.equal(edited.length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }

  const sharedDir = fs.mkdtempSync(path.join(os.tmpdir(), 'embed-phase1-shared-'));
  const shared = worldChannel();
  const sharedClient = { user: { id: BOT_ID }, channels: { fetch: async () => shared.channel } };
  const table = {
    events: [{ description: 'Double affinity', node: 'Earth', eta: '1d' }],
    alerts: [],
    sortie: { boss: 'Ambulas', eta: '12h', variants: [] },
    arbitration: { node: 'Helene', type: 'Defense', enemy: 'Grineer', eta: '40m' },
    nightwave: { season: 1, activeChallenges: [] },
    voidTrader: { character: "Baro Ki'Teer", location: 'Orcus Relay', active: true, eta: '2d', inventory: [] },
    steelPath: { currentReward: { name: 'Forma' }, remaining: '1d', rotation: [] },
    duviriCycle: { state: 'joy', timeLeft: '1h', choices: [] },
    deepArchimedea: { eta: '1d', missions: [] },
    descendia: { expiry: '2099-01-01T00:00:00.000Z', challenges: [{ index: 1, typeKey: 'DT_DEFENSE', challenge: 'Old Week' }] }
  };
  try {
    const published = await refreshWarframePanels({
      client: sharedClient,
      env: { NEXUS_DATA_DIR: sharedDir, CEPHALON_WARFRAME_WORLD_CHANNEL_ID: CHANNEL_ID },
      provider: { worldstate: async (pathname) => table[pathname] },
      dir: sharedDir
    });
    assert.equal(published.refreshed, PANELS.length);
    assert.equal(shared.sent.length, PANELS.length);
    assert.equal(shared.sent.filter((body) => String(body.embeds?.[0]?.image?.url || '').includes('cephalon-panel-banner.png')).length, 1);
    const second = await refreshWarframePanels({
      client: sharedClient,
      env: { NEXUS_DATA_DIR: sharedDir, CEPHALON_WARFRAME_WORLD_CHANNEL_ID: CHANNEL_ID },
      provider: { worldstate: async (pathname) => table[pathname] },
      dir: sharedDir
    });
    assert.equal(second.refreshed, PANELS.length);
    assert.equal(shared.sent.length, PANELS.length);
  } finally {
    fs.rmSync(sharedDir, { recursive: true, force: true });
  }
});

test('legacy and new clan markers parse to the same state and user', () => {
  const userId = '1552750453287161947';
  const legacy = parseClanMarker(`cephalon:clan:pending:${userId}`);
  const branded = parseClanMarker(`Many Worlds One Nexus • clan pending:${userId}`);
  assert.deepEqual(legacy, { state: 'pending', userId });
  assert.deepEqual(branded, legacy);
  assert.deepEqual(parseClanMarker(`Many Worlds One Nexus • clan approved:${userId}`), { state: 'approved', userId });
  assert.equal(parseClanMarker('cephalon:clan:pending:nope'), null);
});

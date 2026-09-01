'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ARTWORK_VERSION,
  APPROVED_ART_COMMIT,
  APPROVED_CACHE_IMAGE_FILES,
  approvedCacheImageUrl,
  reconcileDinoBoxImages
} = require('../src/sentinel/ark-dino-box-shop-image-extension.cjs');

const EXPECTED_EXACT = Object.freeze({
  coastal: 'nexus-dino-box-coastal.webp',
  forest: 'nexus-dino-box-forest.webp',
  swamp: 'nexus-dino-box-swamp.webp',
  mountain: 'nexus-dino-box-mountain.webp',
  ocean: 'nexus-dino-box-ocean.webp',
  deepcave: 'nexus-dino-box-deepcave.webp',
  apex: 'nexus-dino-box-apex.webp',
  'fantastical-tames': 'nexus-dino-box-fantastical-tames.webp',
  'bobs-tall-tales': 'nexus-dino-box-bobs-tall-tales.webp'
});

const TEST_WEBP = 'UklGRngAAABXRUJQAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';

function envFor(cacheId) {
  const suffix = String(cacheId).replace(/-/g, '_').toUpperCase();
  const key = cacheId === 'deepcave'
    ? 'NEXUS_DINO_BOX_ART_DEEPCAVE_B64'
    : `NEXUS_DINO_BOX_ART_${suffix}_B64`;
  return { [key]: TEST_WEBP };
}

test('Dino Box shop uses the owner-managed Google Drive reference set for all nine caches', () => {
  assert.equal(ARTWORK_VERSION, 3);
  assert.equal(APPROVED_ART_COMMIT, 'google-drive-wshop-cache-references');
  assert.deepEqual(APPROVED_CACHE_IMAGE_FILES, EXPECTED_EXACT);
  for (const [cacheId, file] of Object.entries(EXPECTED_EXACT)) {
    assert.equal(approvedCacheImageUrl(cacheId), `attachment://${file}`);
  }
  assert.equal(approvedCacheImageUrl('not-a-cache'), '');
});

test('all current Dino Box caches resolve to embed-referenced WebP artwork', () => {
  assert.equal(Object.keys(APPROVED_CACHE_IMAGE_FILES).length, 9);
  for (const cacheId of Object.keys(EXPECTED_EXACT)) {
    const url = approvedCacheImageUrl(cacheId);
    assert.match(url, /^attachment:\/\/nexus-dino-box-.+\.webp$/);
    assert.doesNotMatch(url, /raw\.githubusercontent\.com|cache-references\//);
  }
});

test('Discord image reconciliation renders artwork inside the embed using the referenced attachment', async () => {
  let edited = null;
  const message = {
    author: { id: 'bot-1' },
    attachments: new Map(),
    embeds: [{
      footer: { text: 'Nexus Dino Box Shop • cache:coastal' },
      image: null,
      toJSON: () => ({ title: 'Coastal Cache', footer: { text: 'Nexus Dino Box Shop • cache:coastal' } })
    }],
    edit: async (payload) => { edited = payload; }
  };
  const channel = {
    type: 0,
    name: 'dino-box-shop',
    id: 'channel-1',
    messages: { fetch: async () => new Map([['message-1', message]]) }
  };
  const guild = {
    client: { user: { id: 'bot-1' } },
    channels: { cache: { find: (predicate) => predicate(channel) ? channel : null } }
  };

  const result = await reconcileDinoBoxImages(guild, envFor('coastal'));
  assert.equal(result.updated, 1);
  assert.equal(result.seen, 1);
  assert.deepEqual(result.missing, []);
  assert.ok(edited);
  assert.deepEqual(edited.attachments, []);
  assert.equal(edited.files.length, 1);
  assert.equal(edited.files[0].name, 'nexus-dino-box-coastal.webp');
  assert.ok(Buffer.isBuffer(edited.files[0].attachment));
  assert.equal(edited.embeds[0].image.url, 'attachment://nexus-dino-box-coastal.webp');
});

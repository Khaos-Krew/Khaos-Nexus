'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  APPROVED_ART_COMMIT,
  APPROVED_CACHE_IMAGE_FILES,
  approvedCacheImageUrl,
  reconcileDinoBoxImages
} = require('../src/sentinel/ark-dino-box-shop-image-extension.cjs');

const EXPECTED_EXACT = Object.freeze({
  coastal: 'nexus-cache-coastal-reference.jpg',
  forest: 'nexus-cache-forest-reference.jpg',
  swamp: 'nexus-cache-swamp-reference.jpg',
  mountain: 'nexus-cache-mountain-reference.jpg'
});

test('Dino Box shop uses the owner-approved ARK cache reference commit, not generated placeholder art', () => {
  assert.equal(APPROVED_ART_COMMIT, 'd975933a8188844bbfc6c64968fd3303357df989');
  for (const [cacheId, file] of Object.entries(EXPECTED_EXACT)) {
    assert.equal(APPROVED_CACHE_IMAGE_FILES[cacheId], file);
    const url = approvedCacheImageUrl(cacheId);
    assert.match(url, /^https:\/\/raw\.githubusercontent\.com\/Khaos-Krew\/Khaos-Nexus\//);
    assert.ok(url.endsWith(`/assets/ark/wshop/cache-references/${file}`));
    assert.doesNotMatch(url, /nexus-[a-z]+-cache\.png$/);
  }
});

test('all current Dino Box caches resolve to approved repository reference artwork', () => {
  for (const cacheId of ['coastal', 'forest', 'swamp', 'mountain', 'ocean', 'deepcave', 'apex']) {
    const url = approvedCacheImageUrl(cacheId);
    assert.match(url, /cache-references\/nexus-cache-.+-reference\.jpg$/);
  }
  assert.equal(approvedCacheImageUrl('not-a-cache'), '');
});

test('Discord image reconciliation renders artwork inside the embed without a loose file attachment', async () => {
  let edited = null;
  const message = {
    author: { id: 'bot-1' },
    embeds: [{
      footer: { text: 'Nexus Dino Box Shop • cache:coastal' },
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

  const result = await reconcileDinoBoxImages(guild);
  assert.equal(result.updated, 1);
  assert.ok(edited);
  assert.equal(edited.attachments.length, 0);
  assert.equal(Object.hasOwn(edited, 'files'), false);
  assert.match(edited.embeds[0].image.url, /^https:\/\/raw\.githubusercontent\.com\//);
  assert.doesNotMatch(edited.embeds[0].image.url, /^attachment:\/\//);
});

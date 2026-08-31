'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handleArkInteraction } = require('../src/sentinel/ark-ops-extension.cjs');

function button(customId, context = {}) {
  const replies = [];
  return {
    interaction: {
      customId,
      user: { id: '123456789012345678' },
      isButton: () => true,
      isChatInputCommand: () => false,
      async deferReply(payload) { replies.push({ kind: 'defer', payload }); },
      async editReply(payload) { replies.push({ kind: 'edit', payload }); }
    },
    context: { config: {}, ...context },
    replies
  };
}

test('ARK player console link button issues the same private one-time verification flow', async () => {
  const prior = process.env.ARK_GEN1_ACCOUNT_LINKING_ENABLED;
  process.env.ARK_GEN1_ACCOUNT_LINKING_ENABLED = 'true';
  try {
    let issuedFor = '';
    const item = button('nexusark:link', {
      identityStore: { issueChallenge(discordUserId) { issuedFor = discordUserId; return { code: 'ABCD2345', expiresAt: '2030-01-01T00:00:00.000Z' }; } }
    });
    assert.equal(await handleArkInteraction(item.interaction, item.context), true);
    assert.equal(issuedFor, item.interaction.user.id);
    assert.match(item.replies.at(-1).payload.content, /!link ABCD2345/);
  } finally {
    if (prior === undefined) delete process.env.ARK_GEN1_ACCOUNT_LINKING_ENABLED;
    else process.env.ARK_GEN1_ACCOUNT_LINKING_ENABLED = prior;
  }
});

test('ARK player console link-status button reuses the protected account status path', async () => {
  const item = button('nexusark:link-status', {
    identityStore: { profileByDiscord: () => null }
  });
  assert.equal(await handleArkInteraction(item.interaction, item.context), true);
  assert.deepEqual(item.replies[0], { kind: 'defer', payload: { flags: 64 } });
  assert.match(item.replies[1].payload.content, /No verified ARK accounts are linked yet/);
  assert.match(item.replies[1].payload.content, /shadow-recruit/);
});

test('ARK player console Dino Cache button provides the live purchase guide without charging', async () => {
  const item = button('nexusark:cache-guide');
  assert.equal(await handleArkInteraction(item.interaction, item.context), true);
  const content = item.replies.at(-1).payload.content;
  assert.match(content, /Nexus Dino Cache Shop/);
  assert.match(content, /Coastal Cache/);
  assert.match(content, /Apex Cache/);
  assert.match(content, /Purchase inside the ARK shop/);
});

test('ARK player console reward status buttons stay read-only and select the requested cadence', async () => {
  const prior = process.env.ARK_GEN1_SUPPORTER_CACHE_ENABLED;
  process.env.ARK_GEN1_SUPPORTER_CACHE_ENABLED = 'true';
  try {
    const calls = [];
    const item = button('nexusark:daily-status', {
      supporterCaches: {
        status(discordUserId, type) {
          calls.push({ discordUserId, type });
          return { ok: false, reason: 'account-not-linked' };
        },
        claim() { throw new Error('status button must not claim a reward'); }
      }
    });
    assert.equal(await handleArkInteraction(item.interaction, item.context), true);
    assert.deepEqual(calls, [{ discordUserId: item.interaction.user.id, type: 'daily' }]);
    assert.match(item.replies.at(-1).payload.content, /ARK account link required/);
  } finally {
    if (prior === undefined) delete process.env.ARK_GEN1_SUPPORTER_CACHE_ENABLED;
    else process.env.ARK_GEN1_SUPPORTER_CACHE_ENABLED = prior;
  }
});

test('unknown ARK player console buttons are ignored', async () => {
  const item = button('nexusark:rank-sync');
  assert.equal(await handleArkInteraction(item.interaction, item.context), false);
  assert.deepEqual(item.replies, []);
});

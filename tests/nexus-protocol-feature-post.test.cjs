'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ProtocolStore } = require('../src/sentinel/protocol/store.cjs');
const { postProtocolMilestone, FEATURE_POST } = require('../src/sentinel/nexus-protocol-feature-post.cjs');
function setup(t, sendError = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-feature-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let sends = 0;
  const client = { user: { id: 'sentinel' }, channels: { fetch: async (id) => {
    assert.equal(id, '1545126905643147264');
    return { isTextBased: () => true, send: async (payload) => {
      sends += 1; assert.equal(payload.content, FEATURE_POST); assert.equal(payload.embeds, undefined);
      assert.deepEqual(payload.allowedMentions, { parse: [] });
      if (sendError) throw new Error('uncertain network outcome');
      return { id: 'new-feature-post' };
    }, messages: { fetch: async ({ message }) => {
      assert.equal(message, 'new-feature-post');
      return { author: { id: 'sentinel' }, content: FEATURE_POST, edit: () => assert.fail('never edit the old embed') };
    } } };
  } } };
  return { root, client, store: new ProtocolStore(root), sends: () => sends };
}
test('completed feature is a new text post and persistent receipt prevents restart duplicates', async (t) => {
  const f = setup(t);
  assert.equal((await postProtocolMilestone(f.client, { store: f.store })).published, true);
  const restart = await postProtocolMilestone(f.client, { store: new ProtocolStore(f.root) });
  assert.equal(restart.unchanged, true); assert.equal(restart.messageId, 'new-feature-post'); assert.equal(f.sends(), 1);
});
test('uncertain send remains reserved instead of duplicating after restart', async (t) => {
  const f = setup(t, true);
  await assert.rejects(postProtocolMilestone(f.client, { store: f.store }), /uncertain network/);
  await assert.rejects(postProtocolMilestone(f.client, { store: new ProtocolStore(f.root) }), /uncertain previous send/);
  assert.equal(f.sends(), 1); assert.equal(f.store.read().receipts[0].state, 'pending');
});
test('concurrent milestone calls publish the feature once', async (t) => {
  const f = setup(t);
  await Promise.all([postProtocolMilestone(f.client, { store: f.store }), postProtocolMilestone(f.client, { store: new ProtocolStore(f.root) })]);
  assert.equal(f.sends(), 1);
});

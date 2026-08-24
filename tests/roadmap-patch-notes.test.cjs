'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { StateStore } = require('../src/sentinel/state-store.cjs');
const {
  ROADMAP_PATCH_NOTES,
  RoadmapPatchNotePublisher,
  assertPublicSafePatchNote,
  messageHasMarker,
  patchNotePayload
} = require('../src/sentinel/roadmap-patch-notes.cjs');

function tempRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'nexus-patch-notes-')); }

function fakeGuild(channel = null) {
  return {
    channels: {
      async fetch(id) {
        if (id) return channel && String(channel.id) === String(id) ? channel : null;
        return new Map(channel ? [[String(channel.id), channel]] : []);
      }
    }
  };
}

function fakePatchChannel(existingMessages = []) {
  const sent = [];
  const channel = {
    id: '123456789012345678',
    name: 'patch-notes',
    isTextBased: () => true,
    sent,
    messages: {
      async fetch() {
        return new Map(existingMessages.map((message, index) => [String(index + 1), message]));
      }
    },
    async send(payload) {
      sent.push(payload);
      return { id: `90000000000000000${sent.length}`, embeds: payload.embeds || [] };
    }
  };
  return channel;
}

test('roadmap notes are limited to 66 and 100 percent milestones and public-safe content', () => {
  const note = ROADMAP_PATCH_NOTES[0];
  assert.equal(note.percent, 100);
  assert.equal(assertPublicSafePatchNote(note), true);
  assert.doesNotMatch(JSON.stringify(patchNotePayload(note)), /thora/i);
  assert.throws(() => assertPublicSafePatchNote({ ...note, percent: 50 }), /66% or 100%/i);
  assert.throws(() => assertPublicSafePatchNote({ ...note, summary: 'Thora private detail' }), /restricted private-edition content/i);
});

test('publisher posts a milestone exactly once and persists the publication ledger', async () => {
  const root = tempRoot();
  try {
    const state = new StateStore(root);
    const channel = fakePatchChannel();
    const publisher = new RoadmapPatchNotePublisher({ state, notes: [ROADMAP_PATCH_NOTES[0]], logger: { log() {}, warn() {}, error() {} } });
    const first = await publisher.publishPending(fakeGuild(channel));
    assert.deepEqual(first.posted, [ROADMAP_PATCH_NOTES[0].key]);
    assert.equal(channel.sent.length, 1);
    assert.equal(channel.sent[0].allowedMentions.parse.length, 0);

    const second = await publisher.publishPending(fakeGuild(channel));
    assert.deepEqual(second.skipped, [ROADMAP_PATCH_NOTES[0].key]);
    assert.equal(channel.sent.length, 1);

    const reopened = new StateStore(root);
    const saved = reopened.getRoadmapPatchNote(ROADMAP_PATCH_NOTES[0].key);
    assert.equal(saved.percent, 100);
    assert.equal(saved.channelId, channel.id);
    assert.ok(saved.messageId);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('publisher adopts an existing milestone marker instead of duplicating after state loss', async () => {
  const root = tempRoot();
  try {
    const note = ROADMAP_PATCH_NOTES[0];
    const existing = { embeds: [{ footer: { text: `Nexus Sentinal • Roadmap milestone • ${note.key}` } }] };
    assert.equal(messageHasMarker(existing, note), true);
    const channel = fakePatchChannel([existing]);
    const state = new StateStore(root);
    const publisher = new RoadmapPatchNotePublisher({ state, notes: [note], logger: { log() {}, warn() {}, error() {} } });
    const result = await publisher.publishPending(fakeGuild(channel));
    assert.deepEqual(result.adopted, [note.key]);
    assert.equal(channel.sent.length, 0);
    assert.equal(state.getRoadmapPatchNote(note.key).adoptedExistingMessage, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('missing patch-notes channel leaves milestone pending', async () => {
  const root = tempRoot();
  try {
    const note = ROADMAP_PATCH_NOTES[0];
    const state = new StateStore(root);
    const publisher = new RoadmapPatchNotePublisher({ state, notes: [note], logger: { log() {}, warn() {}, error() {} } });
    const result = await publisher.publishPending(fakeGuild(null));
    assert.equal(result.warnings.length, 1);
    assert.equal(state.getRoadmapPatchNote(note.key), null);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

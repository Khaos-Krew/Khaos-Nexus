'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { COMMUNITY_SUGGESTIONS_PATCH_NOTE } = require('../src/sentinel/roadmap-patch-note-extension.cjs');
const { assertPublicSafePatchNote, patchNotePayload } = require('../src/sentinel/roadmap-patch-notes.cjs');

test('Community Suggestions patch note is a public-safe 66 percent milestone', () => {
  assert.equal(COMMUNITY_SUGGESTIONS_PATCH_NOTE.key, 'community-suggestions:66');
  assert.equal(COMMUNITY_SUGGESTIONS_PATCH_NOTE.percent, 66);
  assert.equal(assertPublicSafePatchNote(COMMUNITY_SUGGESTIONS_PATCH_NOTE), true);
  const payload = patchNotePayload(COMMUNITY_SUGGESTIONS_PATCH_NOTE);
  const text = JSON.stringify(payload);
  assert.match(text, /Community Suggestions Core Ready/);
  assert.match(text, /durable SUG identifiers/);
  assert.match(text, /self-vote prevention/);
  assert.match(text, /Owner review/);
  assert.doesNotMatch(text, /thora/i);
});

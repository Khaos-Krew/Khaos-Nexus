'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ABOUT_PATCH_NOTE } = require('../src/sentinel/roadmap-patch-note-extension.cjs');
const { assertPublicSafePatchNote, patchNotePayload } = require('../src/sentinel/roadmap-patch-notes.cjs');

test('About completion patch note is a public-safe 100 percent milestone', () => {
  assert.equal(ABOUT_PATCH_NOTE.key, 'community-about-sharing:100');
  assert.equal(ABOUT_PATCH_NOTE.percent, 100);
  assert.equal(assertPublicSafePatchNote(ABOUT_PATCH_NOTE), true);
  const payload = patchNotePayload(ABOUT_PATCH_NOTE);
  const text = JSON.stringify(payload);
  assert.match(text, /Community About & Sharing Complete/);
  assert.match(text, /#about/);
  assert.match(text, /permanent unlimited-use Discord invite/);
  assert.match(text, /without creating duplicate managed posts/);
  assert.doesNotMatch(text, /thora/i);
});

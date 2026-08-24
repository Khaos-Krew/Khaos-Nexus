'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ROADMAP_PATCH_NOTES,
  assertPublicSafePatchNote
} = require('../src/sentinel/roadmap-patch-notes.cjs');

test('Sentinal role authority 100 percent milestone is queued and public-safe', () => {
  const note = ROADMAP_PATCH_NOTES.find((item) => item.key === 'sentinal-role-authority:100');
  assert.ok(note);
  assert.equal(note.percent, 100);
  assert.equal(note.section, 'Sentinal Discord Role Authority');
  assert.equal(assertPublicSafePatchNote(note), true);
  const text = [note.title, note.summary, ...(note.highlights || [])].join('\n').toLowerCase();
  assert.equal(text.includes('thora'), false);
});

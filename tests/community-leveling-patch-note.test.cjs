'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ROADMAP_PATCH_NOTES, assertPublicSafePatchNote } = require('../src/sentinel/roadmap-patch-notes.cjs');

test('community leveling 66 percent milestone is queued and public-safe', () => {
  const note = ROADMAP_PATCH_NOTES.find((item) => item.key === 'community-leveling:66');
  assert.ok(note);
  assert.equal(note.percent, 66);
  assert.equal(note.section, 'Community XP & Leveling');
  assert.equal(assertPublicSafePatchNote(note), true);
  const text = [note.title, note.summary, ...(note.highlights || [])].join('\n').toLowerCase();
  assert.match(text, /community/);
  assert.match(text, /leaderboard/);
  assert.match(text, /shop\/supporter/);
  assert.equal(text.includes('thora'), false);
});

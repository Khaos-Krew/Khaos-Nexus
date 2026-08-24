'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ROADMAP_PATCH_NOTES, assertPublicSafePatchNote } = require('../src/sentinel/roadmap-patch-notes.cjs');

test('staff workspace 66 percent milestone is queued and public-safe', () => {
  const note = ROADMAP_PATCH_NOTES.find((item) => item.key === 'staff-workspace:66');
  assert.ok(note);
  assert.equal(note.percent, 66);
  assert.equal(note.section, 'Staff Workspace');
  assert.equal(assertPublicSafePatchNote(note), true);
  const text = [note.title, note.summary, ...(note.highlights || [])].join('\n').toLowerCase();
  assert.match(text, /staff/);
  assert.match(text, /office threads/);
  assert.match(text, /command reference/);
  assert.match(text, /preserved existing staff channels/);
  assert.equal(text.includes('thora'), false);
});

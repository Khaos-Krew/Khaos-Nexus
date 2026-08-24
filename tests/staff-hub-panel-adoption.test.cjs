'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  STAFF_PANEL_MARKER,
  LEGACY_STAFF_PANEL_MARKERS,
  ADMIN_PANEL_MARKER,
  panelMatches
} = require('../src/sentinel/staff-workspace.cjs');

const BOT_ID = '111111111111111111';

test('current staff hub reconciliation adopts both v1 and v2 managed markers', () => {
  const current = { author: { id: BOT_ID }, embeds: [{ footer: { text: STAFF_PANEL_MARKER } }] };
  const legacy = { author: { id: BOT_ID }, embeds: [{ footer: { text: LEGACY_STAFF_PANEL_MARKERS[0] } }] };
  assert.equal(panelMatches(current, STAFF_PANEL_MARKER, BOT_ID), true);
  assert.equal(panelMatches(legacy, STAFF_PANEL_MARKER, BOT_ID), true);
});

test('legacy adoption remains scoped to the staff hub marker and bot ownership', () => {
  const legacy = { author: { id: BOT_ID }, embeds: [{ footer: { text: LEGACY_STAFF_PANEL_MARKERS[0] } }] };
  assert.equal(panelMatches(legacy, ADMIN_PANEL_MARKER, BOT_ID), false);
  assert.equal(panelMatches(legacy, STAFF_PANEL_MARKER, '222222222222222222'), false);
});

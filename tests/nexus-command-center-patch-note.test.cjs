'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NEXUS_COMMAND_CENTER_PATCH_NOTE } = require('../src/sentinel/roadmap-patch-note-extension.cjs');

test('Nexus command-center completion note is a public-safe 100 percent milestone', () => {
  assert.equal(NEXUS_COMMAND_CENTER_PATCH_NOTE.key, 'nexus-command-center:100');
  assert.equal(NEXUS_COMMAND_CENTER_PATCH_NOTE.percent, 100);
  const text = JSON.stringify(NEXUS_COMMAND_CENTER_PATCH_NOTE).toLowerCase();
  assert.match(text, /#nexus-commands/);
  assert.match(text, /achievements/);
  for (const forbidden of ['thora', 'private assistant', '/xp', '/shield', '/nexus run']) {
    assert.equal(text.includes(forbidden), false, `public patch note leaked ${forbidden}`);
  }
});

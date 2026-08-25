'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const gateDoc = fs.readFileSync(path.join(__dirname, '..', 'docs', 'CREATOR_LEVEL_GATE.md'), 'utf8');

test('creator application level gate is explicitly tied to Community XP', () => {
  assert.match(gateDoc, /Community XP\/Level system/i);
  assert.match(gateDoc, /Default minimum application level:\s*\*\*10\*\*/i);
  assert.match(gateDoc, /fail closed/i);
  assert.match(gateDoc, /immutable Discord user IDs/i);
});

test('creator application level gate preserves existing approved creators', () => {
  assert.match(gateDoc, /does not revoke or downgrade already-approved creators/i);
  assert.match(gateDoc, /revocation remains a staff moderation action/i);
});

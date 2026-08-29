'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const policy = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../config/ark/shop/cache-policy.json'), 'utf8'));

test('launch cache policy disables Shiny and keeps Dino Depot fail-closed delivery', () => {
  assert.equal(policy.shinyEnabled, false);
  assert.deepEqual(policy.levelRange, { min: 200, max: 300 });
  assert.equal(policy.delivery, 'Dino Depot SpawnDinoInBall');
  assert.equal(policy.failClosed, true);
});

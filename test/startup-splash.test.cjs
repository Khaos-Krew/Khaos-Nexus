'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { STARTUP_TIMEOUT_MS, splashSource } = require('../main/startup-splash-extension.cjs');

test('startup splash blocks interaction until the real feature-ready event', () => {
  const source = splashSource();
  assert.match(source, /khaos-starting/);
  assert.match(source, /pointer-events: none/);
  assert.match(source, /khaos:features-ready/);
  assert.match(source, /unlock\(false\)/);
});

test('startup splash uses the Khaos Nexus crest and real progress details', () => {
  const source = splashSource();
  assert.match(source, /\.\.\/assets\/icon\.png/);
  assert.match(source, /feature-loading/);
  assert.match(source, /detail\.position/);
  assert.match(source, /detail\.remaining/);
});

test('startup splash exposes recovery without silently unlocking', () => {
  const source = splashSource();
  assert.equal(STARTUP_TIMEOUT_MS, 45000);
  assert.match(source, /Startup is taking longer than expected/);
  assert.match(source, /Retry Interface/);
  assert.match(source, /Open Limited Mode/);
  assert.doesNotMatch(source, /setTimeout\(\(\) => unlock\(false\)/);
});

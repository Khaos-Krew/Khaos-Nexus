'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { restartScheduleEnabled } = require('../src/sentinel/ark-restart-scheduler-extension.cjs');

test('ARK automatic restart schedule fails closed unless explicitly enabled', () => {
  const key = 'ARK_GEN1_RESTART_SCHEDULE_ENABLED';
  const original = process.env[key];
  try {
    delete process.env[key];
    assert.equal(restartScheduleEnabled(), false);
    process.env[key] = 'false';
    assert.equal(restartScheduleEnabled(), false);
    process.env[key] = 'true';
    assert.equal(restartScheduleEnabled(), true);
  } finally {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
});

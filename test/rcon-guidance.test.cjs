'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { normalizeRconEndpoint } = require('../bot/rcon.cjs');

test('RCON endpoint validation separates host and port fields', () => {
  assert.deepEqual(normalizeRconEndpoint('192.0.2.10', 27020), { host: '192.0.2.10', port: 27020 });
  assert.deepEqual(normalizeRconEndpoint('[2001:db8::1]', 27020), { host: '2001:db8::1', port: 27020 });
  assert.throws(() => normalizeRconEndpoint('192.0.2.10:27020', 27020), /separate fields/i);
  assert.throws(() => normalizeRconEndpoint('https://example.com', 27020), /without http/i);
  assert.throws(() => normalizeRconEndpoint('example.com', 70000), /between 1 and 65535/i);
});

test('RCON connection errors explain pre-authentication and port failures', () => {
  const source = fs.readFileSync(path.join(__dirname, '..', 'bot', 'rcon.cjs'), 'utf8');
  const extension = fs.readFileSync(path.join(__dirname, '..', 'main', 'rcon-validation-extension.cjs'), 'utf8');
  const entry = fs.readFileSync(path.join(__dirname, '..', 'main', 'entry.cjs'), 'utf8');
  assert.match(source, /closed before authentication/i);
  assert.match(source, /RCON port rather than the game\/query port/i);
  assert.match(source, /RCON host could not be resolved/i);
  assert.match(extension, /normalizeRconEndpoint/);
  assert.match(extension, /palworldRest/);
  assert.match(entry, /rcon-validation-extension\.cjs/);
});

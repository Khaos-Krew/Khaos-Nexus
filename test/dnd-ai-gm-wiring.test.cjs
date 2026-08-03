'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('AI Game Master runtime exposes only explicit Owner IPC actions', () => {
  const source = read('main/dnd-ai-gm-extension.cjs');
  for (const channel of [
    'dnd:ai-gm-get', 'dnd:ai-gm-preview', 'dnd:ai-gm-sync', 'dnd:ai-gm-turn',
    'dnd:ai-gm-retry', 'dnd:ai-gm-resume', 'dnd:ai-gm-apply', 'dnd:ai-gm-recap', 'dnd:ai-gm-end'
  ]) assert.match(source, new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(source, /assertOwner/);
  assert.match(source, /confirmed !== true/);
  assert.doesNotMatch(source, /setInterval|automatic.*Discord|rollDice|initiative|currentHp\s*=/i);
});

test('turn input is persisted before the network request and failures remain retryable records', () => {
  const source = read('main/dnd-ai-gm-extension.cjs');
  const pending = source.indexOf('recordPendingTurn');
  const network = source.indexOf('callAiService(binding.endpoint, campaignTurnsPath');
  assert.ok(pending >= 0 && network > pending);
  assert.match(source, /failTurn/);
  assert.match(source, /retryFailedTurn/);
  assert.match(source, /sanitizeServiceError/);
});

test('workspace makes synchronization, generation, safety resume, suggestion application and ending explicit', () => {
  const source = read('renderer/dnd-ai-gm.js');
  assert.match(source, /Preview Exact Campaign Copy/);
  assert.match(source, /Confirm and Synchronize/);
  assert.match(source, /Confirm and Generate Turn/);
  assert.match(source, /Generation paused by safety lock/);
  assert.match(source, /Apply Selected/);
  assert.match(source, /End AI GM Session/);
  assert.doesNotMatch(source, /setInterval|auto.?submit|auto.?apply/i);
});

test('private persistence excludes AI Game Master state from public and bot projections', () => {
  const source = read('main/dnd-ai-gm-persistence-extension.cjs');
  for (const field of ['aiGmBindings', 'aiGmSessions', 'aiGmTurns']) assert.match(source, new RegExp(`delete safe\\.${field}`));
  assert.match(source, /getPublicConfig/);
  assert.match(source, /getRuntimeBootstrap/);
  assert.match(source, /getRegisteredBotBootstraps/);
});

test('startup loads AI GM persistence before runtime orchestration', () => {
  const entry = read('main/entry.cjs');
  const persistence = entry.indexOf("require('./dnd-ai-gm-persistence-extension.cjs').install()");
  const runtime = entry.indexOf("require('./dnd-ai-gm-extension.cjs').install()");
  assert.ok(persistence >= 0);
  assert.ok(runtime > persistence);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_TEMPLATE,
  clean,
  resultSummary,
  progressText
} = require('../renderer/dnd-discord-provisioning.js');

const root = path.join(__dirname, '..');

test('renderer template exposes the approved category channel plan', () => {
  assert.deepEqual(DEFAULT_TEMPLATE.map((item) => item.key), [
    'campaign-info',
    'table-chat',
    'character-chat',
    'dice-rolls',
    'session-notes',
    'quests-and-loot',
    'dm-private',
    'game-table'
  ]);
  assert.equal(DEFAULT_TEMPLATE.filter((item) => item.required).length, 2);
  assert.equal(DEFAULT_TEMPLATE.find((item) => item.key === 'game-table').type, 'voice');
});

test('renderer summaries distinguish created reused and failed resources', () => {
  const summary = resultSummary({
    results: [
      { status: 'created' },
      { status: 'repaired' },
      { status: 'reused' },
      { status: 'failed' },
      { status: 'binding-failed' }
    ]
  });
  assert.deepEqual(summary, { created: 2, reused: 1, failed: 2, total: 5 });
  assert.match(progressText({ phase: 'channel', status: 'creating', name: 'table-chat' }), /table-chat/);
  assert.match(progressText({ phase: 'complete', status: 'partial', failedCount: 2 }), /2 item/);
  assert.equal(clean('  campaign   server  ', 90), 'campaign server');
});

test('provisioning extension registers preview start and status without replacing the startup chain', () => {
  const extension = fs.readFileSync(path.join(root, 'main', 'dnd-discord-provisioning-extension.cjs'), 'utf8');
  const entry = fs.readFileSync(path.join(root, 'main', 'entry.cjs'), 'utf8');
  const ownerIndex = entry.indexOf("require('./dnd-owner-workflows-extension.cjs').install();");
  const provisioningIndex = entry.indexOf("require('./dnd-discord-provisioning-extension.cjs').install();");
  const licenseIndex = entry.indexOf("require('./dnd-owner-license-default-extension.cjs').install();");

  assert.match(extension, /dnd-provision:preview/);
  assert.match(extension, /dnd-provision:start/);
  assert.match(extension, /dnd-provision:status/);
  assert.match(extension, /dnd-discord-provisioning\.css/);
  assert.match(extension, /dnd-discord-provisioning\.js/);
  assert.ok(ownerIndex >= 0 && provisioningIndex > ownerIndex && licenseIndex > provisioningIndex);
  assert.equal((entry.match(/dnd-discord-provisioning-extension/g) || []).length, 1);
});

test('provisioning renderer avoids MutationObserver and permanent fast polling', () => {
  const source = fs.readFileSync(path.join(root, 'renderer', 'dnd-discord-provisioning.js'), 'utf8');
  assert.doesNotMatch(source, /MutationObserver/);
  assert.match(source, /dnd-provision:preview/);
  assert.match(source, /dnd-provision:start/);
  assert.match(source, /dnd-provision:status/);
  assert.match(source, /setTimeout\(ensureMounted, workspace\(\)\?\.classList\.contains\('active'\) \? 2000 : 5000\)/);
  assert.doesNotMatch(source, /setInterval/);
});

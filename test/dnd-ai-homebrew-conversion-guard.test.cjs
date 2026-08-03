'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('conversion guard loads after AI homebrew and before renderer contract', () => {
  const root = path.join(__dirname, '..');
  const entry = fs.readFileSync(path.join(root, 'main', 'entry.cjs'), 'utf8');
  const homebrew = entry.indexOf("require('./dnd-ai-homebrew-extension.cjs').install()");
  const guard = entry.indexOf("require('./dnd-ai-homebrew-conversion-guard-extension.cjs').install()");
  const ui = entry.indexOf("require('./dnd-ai-homebrew-ui-contract-extension.cjs').install()");
  assert.ok(homebrew >= 0);
  assert.ok(guard > homebrew);
  assert.ok(ui > guard);
});

test('conversion guard removes a successfully converted proposal from the queue', () => {
  const root = path.join(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'main', 'dnd-ai-homebrew-conversion-guard-extension.cjs'), 'utf8');
  assert.match(source, /super\.convertDndAiHomebrewProposal\(input\)/);
  assert.match(source, /removeDndAiHomebrewProposal\(result\.proposal\.id\)/);
  assert.match(source, /proposalRemoved: true/);
});

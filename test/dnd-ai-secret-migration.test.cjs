'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('legacy desktop OpenAI key migration is loaded after Co-DM persistence and before services', () => {
  const root = path.join(__dirname, '..');
  const entry = fs.readFileSync(path.join(root, 'main', 'entry.cjs'), 'utf8');
  const persistence = entry.indexOf("require('./dnd-co-dm-persistence-extension.cjs').install()");
  const migration = entry.indexOf("require('./dnd-ai-secret-migration-extension.cjs').install()");
  const stability = entry.indexOf("require('./dnd-co-dm-stability-extension.cjs').install()");
  assert.ok(persistence >= 0);
  assert.ok(migration > persistence);
  assert.ok(stability > migration);
});

test('migration deletes and saves the obsolete desktop provider secret', () => {
  const root = path.join(__dirname, '..');
  const source = fs.readFileSync(path.join(root, 'main', 'dnd-ai-secret-migration-extension.cjs'), 'utf8');
  assert.match(source, /hasOwnProperty\.call\(this\.secrets \|\| \{\}, 'dndCoDmOpenAiKey'\)/);
  assert.match(source, /delete this\.secrets\.dndCoDmOpenAiKey/);
  assert.match(source, /this\.saveSecrets\(\)/);
  assert.doesNotMatch(source, /api\.openai\.com|OPENAI_API_KEY/);
});

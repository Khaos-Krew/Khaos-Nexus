'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');

function filesUnder(relativeDirectory) {
  const directory = path.join(root, relativeDirectory);
  const output = [];
  const visit = (current) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (entry.isFile() && entry.name.endsWith('.cjs')) output.push(full);
    }
  };
  visit(directory);
  return output;
}

function relative(file) {
  return path.relative(root, file).replaceAll('\\', '/');
}

test('main process constructs Core journal, idempotency store, and command gateway only in NexusCoreService', () => {
  const constructorPattern = /new\s+(?:FileEventJournal|FileOperationStore|CommandGateway)\s*\(/;
  const offenders = filesUnder('main')
    .filter((file) => constructorPattern.test(fs.readFileSync(file, 'utf8')))
    .map(relative)
    .sort();
  assert.deepEqual(offenders, ['main/services/nexus-core-service.cjs']);
});

test('desktop boot initializes Nexus Core before the scheduler mutation bridge and main runtime', () => {
  const entry = fs.readFileSync(path.join(root, 'main', 'entry.cjs'), 'utf8');
  const foundation = entry.indexOf("require('./nexus-core-foundation-extension.cjs').install()");
  const schedulerGateway = entry.indexOf("require('./nexus-core-scheduler-gateway-extension.cjs').install()");
  const main = entry.indexOf("require('./main.cjs')");
  assert.ok(foundation >= 0);
  assert.ok(schedulerGateway > foundation);
  assert.ok(main > schedulerGateway);
});

test('scheduler mutation bridge consumes the singleton Core service instead of creating a parallel authority', () => {
  const source = fs.readFileSync(path.join(root, 'main', 'nexus-core-scheduler-gateway-extension.cjs'), 'utf8');
  assert.match(source, /getNexusCoreService/);
  assert.match(source, /core\.commandGateway\.dispatch/);
  assert.doesNotMatch(source, /new\s+(?:FileEventJournal|FileOperationStore|CommandGateway)\s*\(/);
});

test('Core boot foundation creates no worker, timer, network, or Electron authority of its own', () => {
  const source = fs.readFileSync(path.join(root, 'main', 'nexus-core-foundation-extension.cjs'), 'utf8');
  assert.match(source, /getNexusCoreService/);
  assert.doesNotMatch(source, /setInterval|setTimeout|BrowserWindow|ipcMain|net\.|https?\.|child_process|spawn\(/i);
});

test('AI tool boundary has no raw infrastructure dependencies', () => {
  const source = fs.readFileSync(path.join(root, 'shared', 'nexus-core', 'ai-tool-gateway.cjs'), 'utf8');
  assert.doesNotMatch(source, /child_process|spawn\(|exec\(|rcon|discord\.js|supabase|postgres|shell/i);
  assert.match(source, /this\.commandGateway\.dispatch/);
  assert.match(source, /approvalVerifier/);
});

test('Core context broker never imports game, Discord, database, or model providers directly', () => {
  const source = fs.readFileSync(path.join(root, 'shared', 'nexus-core', 'context-broker.cjs'), 'utf8');
  assert.doesNotMatch(source, /rcon|discord\.js|supabase|postgres|openai|anthropic|ollama/i);
  assert.match(source, /registerProvider/);
  assert.match(source, /registerWorker/);
});

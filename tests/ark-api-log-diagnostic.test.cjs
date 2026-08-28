'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { redactLogLine, relevantLogLines, apiLifecycleLines, startupIssueLines, inspectSavedLogs } = require('../src/sentinel/ark-api-log-diagnostic.cjs');

test('ArkShop API log redaction removes password URI credentials and IP addresses', () => {
  const line = 'ArkShop mysql failed MysqlPass=super-secret mysql://dbuser:dbpass@database.internal:3306/shop host=72.46.128.202';
  const safe = redactLogLine(line);
  assert.match(safe, /ArkShop mysql failed/);
  assert.doesNotMatch(safe, /super-secret|dbuser|dbpass|72\.46\.128\.202/);
  assert.match(safe, /redacted/i);
});

test('ArkShop API log diagnostic keeps only bounded relevant lines', () => {
  const source = [
    'ordinary game line',
    'ArkShop loaded',
    'Mysql database error',
    'another unrelated line'
  ].join('\n');
  const lines = relevantLogLines(source, 20);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /ArkShop/);
  assert.match(lines[1], /Mysql database error/);
});

test('ASA API lifecycle filter captures loader plugin and offset evidence', () => {
  const source = [
    '[API][info] ARK:SA Api V2.03',
    '[API][info] API was successfully loaded',
    '[API][info] Loading plugin ArkShop',
    '[API][info] Loaded all plugins',
    '[API][critical] Failed to get the offset UEngine.Init',
    'Requested by: plugin ArkShop',
    'ordinary game line'
  ].join('\n');
  const lines = apiLifecycleLines(source, 20);
  assert.equal(lines.length, 6);
  assert.match(lines[0], /ARK:SA Api V2\.03/);
  assert.match(lines[1], /successfully loaded/);
  assert.match(lines[3], /Loaded all plugins/);
  assert.match(lines[4], /Failed to get the offset/);
  assert.match(lines[5], /Requested by: plugin ArkShop/);
});

test('ARK startup issue filter captures launch failures without copying ordinary API utility traffic', () => {
  const source = [
    'ordinary game line',
    'LogInit: display normal startup',
    'Crashpad initialized normally',
    'AsaApiUtils mod loaded',
    'Commandline: ?RCONEnabled=True?RCONPort=30081',
    'Fatal error: loader could not initialize',
    'RCON failed to bind',
    'another ordinary line'
  ].join('\n');
  const lines = startupIssueLines(source, 20);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /Fatal error/);
  assert.match(lines[1], /RCON failed to bind/);
  assert.doesNotMatch(lines.join('\n'), /Crashpad|AsaApiUtils|RCONEnabled/);
});

test('Saved Logs fallback inspects recent bounded logs and redacts matching errors', async () => {
  const client = {
    async list(remote) {
      assert.match(remote, /ShooterGame\/Saved\/Logs$/);
      return [
        { name: 'ShooterGame.log', type: '-', size: 200, modifyTime: 20 },
        { name: 'old.log', type: '-', size: 100, modifyTime: 10 },
        { name: 'SavedArks', type: 'd', size: 0, modifyTime: 30 }
      ];
    },
    async get(remote) {
      if (remote.endsWith('ShooterGame.log')) return Buffer.from('ArkShop MySQL connection failed MysqlPass=do-not-leak\nRCON failed to bind 72.46.128.202\n[API][info] API was successfully loaded\nnormal line');
      return Buffer.from('old unrelated line');
    }
  };
  const result = await inspectSavedLogs(client, 'server/ShooterGame');
  assert.equal(result.accessible, true);
  assert.deepEqual(result.filesSeen, ['ShooterGame.log', 'old.log']);
  assert.equal(result.lines.length, 1);
  assert.match(result.lines[0], /ArkShop MySQL connection failed/);
  assert.doesNotMatch(result.lines[0], /do-not-leak/);
  assert.equal(result.issues.length, 2);
  assert.doesNotMatch(result.issues.join('\n'), /72\.46\.128\.202/);
  assert.equal(result.lifecycle.length, 1);
  assert.match(result.lifecycle[0], /API was successfully loaded/);
});

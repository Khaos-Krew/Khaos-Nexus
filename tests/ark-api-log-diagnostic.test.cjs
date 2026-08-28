'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { redactLogLine, relevantLogLines, apiLifecycleLines, startupIssueLines, tailLogLines, normalizeModifyTime, inspectSavedLogs } = require('../src/sentinel/ark-api-log-diagnostic.cjs');

test('ArkShop API log redaction removes password URI credentials and IP addresses', () => {
  const line = 'ArkShop mysql failed MysqlPass=super-secret mysql://dbuser:dbpass@database.internal:3306/shop host=72.46.128.202';
  const safe = redactLogLine(line);
  assert.match(safe, /ArkShop mysql failed/);
  assert.doesNotMatch(safe, /super-secret|dbuser|dbpass|72\.46\.128\.202/);
  assert.match(safe, /redacted/i);
});

test('ArkShop API log diagnostic keeps only bounded relevant lines and ignores ordinary database paths', () => {
  const source = [
    'ordinary game line',
    'LogSentrySdk: using database path D:/ShooterGame/.sentry-native',
    'ArkShop loaded',
    'Mysql database error',
    'Database connection refused',
    'another unrelated line'
  ].join('\n');
  const lines = relevantLogLines(source, 20);
  assert.equal(lines.length, 3);
  assert.match(lines[0], /ArkShop/);
  assert.match(lines[1], /Mysql database error/);
  assert.match(lines[2], /Database connection refused/);
  assert.doesNotMatch(lines.join('\n'), /Sentry/);
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

test('bounded ARK log tail keeps only recent redacted non-empty lines', () => {
  const source = [
    'old line',
    '',
    'middle line 72.46.128.202',
    'MysqlPass=should-not-leak',
    'final line'
  ].join('\n');
  const tail = tailLogLines(source, 3);
  assert.equal(tail.length, 3);
  assert.doesNotMatch(tail.join('\n'), /72\.46\.128\.202|should-not-leak/);
  assert.match(tail[2], /final line/);
});

test('SFTP modify times normalize from seconds or milliseconds', () => {
  assert.equal(normalizeModifyTime(1_700_000_000), '2023-11-14T22:13:20.000Z');
  assert.equal(normalizeModifyTime(1_700_000_000_000), '2023-11-14T22:13:20.000Z');
  assert.equal(normalizeModifyTime(0), null);
});

test('Saved Logs fallback inspects recent bounded logs and reports the newest redacted tail', async () => {
  const client = {
    async list(remote) {
      assert.match(remote, /ShooterGame\/Saved\/Logs$/);
      return [
        { name: 'ShooterGame.log', type: '-', size: 200, modifyTime: 1700000020 },
        { name: 'old.log', type: '-', size: 100, modifyTime: 1700000010 },
        { name: 'SavedArks', type: 'd', size: 0, modifyTime: 1700000030 }
      ];
    },
    async get(remote) {
      if (remote.endsWith('ShooterGame.log')) return Buffer.from('ArkShop MySQL connection failed MysqlPass=do-not-leak\nRCON failed to bind 72.46.128.202\n[API][info] API was successfully loaded\nnormal final line');
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
  assert.equal(result.newest.name, 'ShooterGame.log');
  assert.equal(result.newest.modifiedAt, '2023-11-14T22:13:40.000Z');
  assert.equal(result.newest.tail.length, 4);
  assert.match(result.newest.tail.at(-1), /normal final line/);
  assert.doesNotMatch(result.newest.tail.join('\n'), /do-not-leak|72\.46\.128\.202/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  redactLogLine,
  relevantLogLines,
  apiLifecycleLines,
  startupIssueLines,
  crashRelevantLines,
  tailLogLines,
  parseLoadedMods,
  parseLoadedModIds,
  parseArkVersion,
  startupReadiness,
  normalizeModifyTime,
  inspectCrashArtifacts,
  inspectSavedLogs
} = require('../src/sentinel/ark-api-log-diagnostic.cjs');

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
});

test('ARK startup issue filter captures launch failures without copying ordinary API utility traffic', () => {
  const source = [
    'ordinary game line',
    'Crashpad initialized normally',
    'AsaApiUtils mod loaded',
    'Commandline: ?RCONEnabled=True?RCONPort=30081',
    'Fatal error: loader could not initialize',
    'RCON failed to bind'
  ].join('\n');
  const lines = startupIssueLines(source, 20);
  assert.equal(lines.length, 2);
  assert.doesNotMatch(lines.join('\n'), /Crashpad|AsaApiUtils|RCONEnabled/);
});

test('crash evidence filter keeps likely fault lines only', () => {
  const lines = crashRelevantLines('normal line\nUnhandled Exception: ACCESS_VIOLATION\nArkShop.dll!Hook\nordinary tick', 20);
  assert.equal(lines.length, 2);
  assert.match(lines.join('\n'), /ACCESS_VIOLATION/);
  assert.match(lines.join('\n'), /ArkShop\.dll/);
});

test('bounded ARK log tail keeps only recent redacted non-empty lines', () => {
  const source = ['old line', '', 'middle line 72.46.128.202', 'MysqlPass=should-not-leak', 'final line'].join('\n');
  const tail = tailLogLines(source, 3);
  assert.equal(tail.length, 3);
  assert.doesNotMatch(tail.join('\n'), /72\.46\.128\.202|should-not-leak/);
});

test('ARK log parser detects unique CurseForge project ids and ARK version', () => {
  const source = [
    'ARK Version: 93.7',
    'Loading Mod ShooterGame/Mods/83374/942249_6567374/FC_ArkShopUI/Content/PrimalGameData.uasset : 942249',
    'Loading Mod ShooterGame/Mods/83374/955333_1234567/AsaApiUtils/Content/PrimalGameData.uasset : 955333',
    'Loading Mod ShooterGame/Mods/83374/942249_6567374/FC_ArkShopUI/Content/Other.uasset : 942249'
  ].join('\n');
  assert.deepEqual(parseLoadedModIds(source), ['942249', '955333']);
  assert.deepEqual(parseLoadedMods(source), [
    { id: '942249', nameHint: 'FC Ark Shop UI' },
    { id: '955333', nameHint: 'Asa Api Utils' }
  ]);
  assert.equal(parseArkVersion(source), '93.7');
  assert.equal(parseArkVersion('no version'), '');
});

test('ARK startup readiness distinguishes BattlEye start from a fully advertising server', () => {
  const partial = startupReadiness('BattlEye successfully started.');
  assert.equal(partial.battleyeStarted, true);
  assert.equal(partial.serverStarted, false);
  assert.equal(partial.advertising, false);

  const ready = startupReadiness([
    'BattlEye successfully started.',
    'Server: "Khaos Nexus (Gen 1)" has successfully started!',
    'Steam Subsystem initialized: Success',
    'Full Startup: 23.19 seconds',
    'Server has completed startup and is now advertising for join. (6.76GB Mem)'
  ].join('\n'));
  assert.deepEqual(ready, { battleyeStarted: true, serverStarted: true, steamInitialized: true, fullStartup: true, advertising: true });
});

test('SFTP modify times normalize from seconds or milliseconds', () => {
  assert.equal(normalizeModifyTime(1_700_000_000), '2023-11-14T22:13:20.000Z');
  assert.equal(normalizeModifyTime(1_700_000_000_000), '2023-11-14T22:13:20.000Z');
  assert.equal(normalizeModifyTime(0), null);
});

test('crash artifact inspection is bounded and returns redacted newest evidence', async () => {
  const client = {
    async list(remote) {
      if (remote.endsWith('/Saved/Crashes')) return [{ name: 'UECC-123', type: 'd', modifyTime: 1700000040, size: 0 }];
      if (remote.endsWith('/Saved/Crashes/UECC-123')) return [
        { name: 'CrashContext.runtime-xml', type: '-', modifyTime: 1700000041, size: 180 },
        { name: 'minidump.dmp', type: '-', modifyTime: 1700000041, size: 500 }
      ];
      throw new Error(`unexpected list ${remote}`);
    },
    async get(remote) {
      assert.match(remote, /CrashContext\.runtime-xml$/);
      return Buffer.from('normal\n<ErrorMessage>Unhandled Exception: EXCEPTION_ACCESS_VIOLATION 72.46.128.202</ErrorMessage>\nArkShop.dll!Init MysqlPass=hide-me');
    }
  };
  const result = await inspectCrashArtifacts(client, 'server/ShooterGame');
  assert.equal(result.accessible, true);
  assert.equal(result.newest.name, 'UECC-123');
  assert.equal(result.newest.modifiedAt, '2023-11-14T22:14:00.000Z');
  assert.equal(result.newest.files.length, 1);
  assert.match(result.newest.evidence.join('\n'), /ArkShop\.dll/);
  assert.doesNotMatch(result.newest.evidence.join('\n'), /72\.46\.128\.202|hide-me/);
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
      if (remote.endsWith('ShooterGame.log')) return Buffer.from('ARK Version: 93.7\nLoading Mod ShooterGame/Mods/83374/955333_1/AsaApiUtils/Content/PrimalGameData.uasset : 955333\nArkShop MySQL connection failed MysqlPass=do-not-leak\nRCON failed to bind 72.46.128.202\n[API][info] API was successfully loaded\nBattlEye successfully started.\nnormal final line');
      return Buffer.from('old unrelated line');
    }
  };
  const result = await inspectSavedLogs(client, 'server/ShooterGame');
  assert.equal(result.accessible, true);
  assert.deepEqual(result.filesSeen, ['ShooterGame.log', 'old.log']);
  assert.equal(result.lines.length, 1);
  assert.equal(result.issues.length, 2);
  assert.equal(result.lifecycle.length, 1);
  assert.equal(result.newest.name, 'ShooterGame.log');
  assert.equal(result.newest.modifiedAt, '2023-11-14T22:13:40.000Z');
  assert.equal(result.newest.version, '93.7');
  assert.deepEqual(result.newest.modIds, ['955333']);
  assert.equal(result.newest.readiness.battleyeStarted, true);
  assert.equal(result.newest.readiness.serverStarted, false);
  assert.doesNotMatch(result.newest.tail.join('\n'), /do-not-leak|72\.46\.128\.202/);
});

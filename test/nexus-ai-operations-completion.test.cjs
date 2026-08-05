'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8').replace(/\r\n/g, '\n');

test('Nexus AI recurring checks reuse the shared scheduler and claim the next run before polling', () => {
  const source = read('main/nexus-ai-core-operations-extension.cjs');
  assert.match(source, /class NexusAiSharedSchedulerService extends Original/);
  assert.match(source, /async tick\(\)\s*\{\s*await super\.tick\(\)/);
  assert.match(source, /claimNexusAiMonitorRun\(\{ startedAt, nextRunAt \}\)/);
  assert.match(source, /shared-scheduler-recurring-check/);
  assert.doesNotMatch(source, /new ServerSchedulerService|setInterval\(/);
});

test('monitor settings, sources, subscriptions, and review history persist locally without secrets', () => {
  const source = read('main/nexus-ai-core-operations-extension.cjs');
  assert.match(source, /config\.nexusAiMonitor/);
  assert.match(source, /getNexusAiMonitorConfig/);
  assert.match(source, /upsertNexusAiMonitorSource/);
  assert.match(source, /addNexusAiSubscription/);
  assert.match(source, /recordNexusAiMonitorRun/);
  assert.match(source, /automaticPublicAnnouncements:\s*false/);
  assert.doesNotMatch(source, /config\.nexusAiMonitor[^\n]*(serviceToken|discordToken|providerToken)/);
});

test('the primary bot proxies Nexus AI operations through the desktop main process', () => {
  const main = read('main/nexus-ai-core-operations-extension.cjs');
  const bot = read('bot/nexus-ai-index.cjs');
  assert.match(main, /botPath\(\)[\s\S]*nexus-ai-index\.cjs/);
  assert.match(main, /message\?\.type === 'nexus-ai-request'/);
  assert.match(main, /child\?\.postMessage\?\.\(\{ type: 'nexus-ai-response'/);
  assert.match(bot, /parent\?\.postMessage\(\{[\s\S]*type: 'nexus-ai-request'/);
  assert.match(bot, /require\('\.\/dual-ai-index\.cjs'\)/);
  assert.doesNotMatch(bot, /serviceToken|NEXUS_AI_CORE_SERVICE_TOKEN|Authorization:\s*`Bearer/);
});

test('Discord exposes the complete bounded /nexus command group with permissions and rate limits', () => {
  const source = read('bot/nexus-ai-index.cjs');
  for (const command of ['status', 'ask', 'updates', 'check', 'plan', 'subscribe', 'unsubscribe']) {
    assert.match(source, new RegExp(`setName\\('${command}'\\)`));
  }
  assert.match(source, /PermissionFlagsBits\.Administrator/);
  assert.match(source, /configuredOwnerId/);
  assert.match(source, /assertAuthorizedChannel/);
  assert.match(source, /assertRateLimit/);
  assert.match(source, /ephemeral:\s*true/);
  assert.match(source, /allowedMentions:\s*\{ parse:\s*\[\] \}/);
});

test('Nexus AI remains advisory-only, mention-safe, and isolated from D&D', () => {
  const main = read('main/nexus-ai-core-operations-extension.cjs');
  const bot = read('bot/nexus-ai-index.cjs');
  assert.match(main, /executionAllowed:\s*false/);
  assert.match(main, /maintenanceExecutionAllowed:\s*false/);
  assert.match(main, /dndContextAllowed:\s*false/);
  assert.match(main, /delete context\.dnd/);
  assert.match(main, /delete context\.campaign/);
  assert.match(main, /@everyone\|@here/);
  assert.match(bot, /automatic public announcements/i);
  assert.doesNotMatch(main, /executeAdapterOperation|SourceRcon|server:restart|updater:install/);
});

test('desktop Nexus AI operations UI exposes safe settings, sources, cadence, and history', () => {
  const renderer = read('renderer/nexus-ai-operations.js');
  const css = read('renderer/nexus-ai-operations.css');
  assert.match(renderer, /nexus-ai-core:monitor-state/);
  assert.match(renderer, /nexus-ai-core:monitor-save/);
  assert.match(renderer, /nexus-ai-core:check-now/);
  assert.match(renderer, /nexus-ai-core:source-save/);
  assert.match(renderer, /nexus-ai-core:source-remove/);
  assert.match(renderer, /Last check/);
  assert.match(renderer, /Next check/);
  assert.match(renderer, /Recent checks/);
  assert.match(renderer, /shared scheduler/i);
  assert.match(css, /\.nexus-ai-operations-panel/);
  assert.doesNotMatch(renderer, /serviceToken|discordToken|providerToken/);
});

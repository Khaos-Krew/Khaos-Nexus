'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('dual AI services install after D&D privacy and before module runtime consumers', () => {
  const entry = read('main/entry.cjs');
  const dnd = entry.indexOf("require('./dnd-authorization-summary-extension.cjs').install()");
  const services = entry.indexOf("require('./ai-services-extension.cjs').install()");
  const privacy = entry.indexOf("require('./ai-services-privacy-extension.cjs').install()");
  const modules = entry.indexOf("require('./module-foundation-extension.cjs').install()");
  assert.ok(dnd >= 0 && services > dnd);
  assert.ok(privacy > services);
  assert.ok(modules > privacy);
});

test('desktop exposes independent connection controls and no provider credential fields', () => {
  const source = read('main/ai-services-extension.cjs');
  for (const channel of ['ai:connections-get', 'ai:connections-check', 'ai:core-set-settings', 'ai:core-set-token']) {
    assert.match(source, new RegExp(channel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(source, /require\('\.\/dnd-co-dm-extension\.cjs'\)\.publicPayload\(''\)/);
  assert.match(source, /getAiCoreServiceToken/);
  assert.match(source, /registeredBotsReceiveAiCore:\s*false/);
  assert.match(source, /automaticDiscordPublication:\s*false/);
  assert.match(source, /automaticExecution:\s*false/);
  assert.doesNotMatch(source, /setOpenAi|setProviderKey|OPENAI_API_KEY/);
});

test('primary bot sidecar performs health and capability discovery only', () => {
  const client = read('bot/ai-core-client.cjs');
  const wrapper = read('bot/dual-ai-index.cjs');
  assert.match(client, /AI_CORE_HEALTH_PATH/);
  assert.match(client, /AI_CORE_CAPABILITIES_PATH/);
  assert.match(client, /method:\s*'GET'/);
  assert.doesNotMatch(client, /method:\s*'POST'|discord\/assist|maintenance\/plans|monitor\/poll|updates\/evaluate|incidents\/summarize/);
  assert.match(wrapper, /require\('\.\/index\.cjs'\)/);
  assert.match(wrapper, /ai-core-status/);
  assert.doesNotMatch(wrapper, /dnd:|dnd\.|Khaos-Nexus-AI'/);
});

test('renderer clearly separates D&D AI and Nexus AI Core consumers', () => {
  const source = read('renderer/ai-services.js');
  assert.match(source, /Khaos Nexus D&D AI/);
  assert.match(source, /Nexus AI Core/);
  assert.match(source, /Desktop D&D workspace only/);
  assert.match(source, /primary Nexus Bot/);
  assert.match(source, /Registered secondary bots remain excluded/);
  assert.match(source, /No automatic execution/);
});

test('privacy projection strips audit records and secondary-bot AI metadata', () => {
  const source = read('main/ai-services-privacy-extension.cjs');
  assert.match(source, /delete safe\.aiServices\.audit/);
  assert.match(source, /delete safe\.aiServices/);
  assert.match(source, /delete value\.aiCore/);
  assert.match(source, /getRuntimeBootstrap/);
  assert.match(source, /getRegisteredBotBootstraps/);
});

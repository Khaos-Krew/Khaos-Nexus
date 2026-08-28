'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  forgeCommand,
  bridgeStatusText,
  formatForgeResult,
  buildConstraints
} = require('../src/sentinel/forge-extension.cjs');
const { ForgeClient } = require('../src/sentinel/forge-client.cjs');

test('/forge exposes status, plan, and guarded build subcommands', () => {
  const json = forgeCommand().toJSON();
  assert.equal(json.name, 'forge');
  assert.deepEqual(json.options.map((item) => item.name), ['status', 'plan', 'build']);
  const build = json.options.find((item) => item.name === 'build');
  assert.equal(build.options[0].name, 'goal');
  assert.equal(build.options[0].required, true);
});

test('Forge status text reports bridge configuration without exposing secrets', () => {
  const client = new ForgeClient({
    enabled: true,
    baseUrl: 'forge.internal:8080',
    token: 'super-secret-value',
    defaultRepo: 'Khaos-Krew/Khaos-Nexus',
    defaultBaseRef: 'rebuild/nexus-0.1',
    fetchImpl: async () => { throw new Error('unused'); }
  });
  const text = bridgeStatusText(client, {
    ok: true,
    version: '0.1.0',
    openaiConfigured: true,
    githubConfigured: true,
    writePolicy: 'draft-pr-only'
  });
  assert.match(text, /Bridge: \*\*Enabled\*\*/);
  assert.match(text, /draft-pr-only/);
  assert.doesNotMatch(text, /super-secret-value/);
  assert.doesNotMatch(text, /forge\.internal/);
});

test('Forge build result is bounded for Discord and names the guarded branch', () => {
  const text = formatForgeResult({
    mode: 'execute',
    status: 'completed',
    repo: 'Khaos-Krew/Khaos-Nexus',
    baseRef: 'rebuild/nexus-0.1',
    branch: 'forge/safe-task-1234567',
    output: 'x'.repeat(5000)
  });
  assert.ok(text.length <= 1900);
  assert.match(text, /forge\/safe-task-1234567/);
});

test('Forge requests retain explicit no-merge/no-deploy guardrails', () => {
  const constraints = buildConstraints('123');
  assert.ok(constraints.some((item) => /Do not merge/i.test(item)));
  assert.ok(constraints.some((item) => /draft PR/i.test(item)));
  assert.ok(constraints.some((item) => /Do not merge pull requests or deploy production/i.test(item)));
});

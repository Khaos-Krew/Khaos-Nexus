'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  forgeCommand,
  bridgeStatusText,
  formatForgeResult,
  buildConstraints,
  validForgeBranch
} = require('../src/sentinel/forge-extension.cjs');
const { ForgeClient } = require('../src/sentinel/forge-client.cjs');

test('/forge exposes status, plan, guarded build, and CI-aware repair subcommands', () => {
  const json = forgeCommand().toJSON();
  assert.equal(json.name, 'forge');
  assert.deepEqual(json.options.map((item) => item.name), ['status', 'plan', 'build', 'repair']);

  const build = json.options.find((item) => item.name === 'build');
  assert.equal(build.options[0].name, 'goal');
  assert.equal(build.options[0].required, true);

  const repair = json.options.find((item) => item.name === 'repair');
  assert.equal(repair.options[0].name, 'branch');
  assert.equal(repair.options[0].required, true);
  assert.equal(repair.options[1].name, 'goal');
  assert.equal(repair.options[1].required, false);
});

test('Forge repair accepts only guarded forge namespace branches', () => {
  assert.equal(validForgeBranch('forge/fix-ci-123'), true);
  assert.equal(validForgeBranch('forge/nested/fix_ci.2'), true);
  assert.equal(validForgeBranch('main'), false);
  assert.equal(validForgeBranch('release/v1'), false);
  assert.equal(validForgeBranch('forge/../main'), true);
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

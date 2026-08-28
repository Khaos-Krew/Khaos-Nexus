'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  forgeCommand,
  bridgeStatusText,
  formatForgeResult,
  formatCiStatus,
  buildConstraints,
  validForgeBranch
} = require('../src/sentinel/forge-extension.cjs');
const { ForgeClient } = require('../src/sentinel/forge-client.cjs');

test('/forge exposes status, cost-free CI, plan, guarded build, and repair subcommands', () => {
  const json = forgeCommand().toJSON();
  assert.equal(json.name, 'forge');
  assert.deepEqual(json.options.map((item) => item.name), ['status', 'ci', 'plan', 'build', 'repair']);

  const ci = json.options.find((item) => item.name === 'ci');
  assert.equal(ci.options[0].name, 'branch');
  assert.equal(ci.options[0].required, true);

  const build = json.options.find((item) => item.name === 'build');
  assert.equal(build.options[0].name, 'goal');
  assert.equal(build.options[0].required, true);

  const repair = json.options.find((item) => item.name === 'repair');
  assert.equal(repair.options[0].name, 'branch');
  assert.equal(repair.options[0].required, true);
  assert.equal(repair.options[1].name, 'goal');
  assert.equal(repair.options[1].required, false);
});

test('Forge repair accepts only safe guarded forge namespace branches', () => {
  assert.equal(validForgeBranch('forge/fix-ci-123'), true);
  assert.equal(validForgeBranch('forge/nested/fix_ci.2'), true);
  assert.equal(validForgeBranch('main'), false);
  assert.equal(validForgeBranch('release/v1'), false);
  assert.equal(validForgeBranch('forge/../main'), false);
  assert.equal(validForgeBranch('forge/./task'), false);
  assert.equal(validForgeBranch('forge/task..two'), false);
  assert.equal(validForgeBranch('forge/task.lock'), false);
});

test('Forge status text reports bridge and fallback state without exposing secrets', () => {
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
    fallbackRouting: 'disabled',
    writePolicy: 'draft-pr-only'
  });
  assert.match(text, /Bridge: \*\*Enabled\*\*/);
  assert.match(text, /Fallback routing: \*\*disabled\*\*/);
  assert.match(text, /draft-pr-only/);
  assert.doesNotMatch(text, /super-secret-value/);
  assert.doesNotMatch(text, /forge\.internal/);
});

test('Forge CI text surfaces failures and explicitly identifies no-model checking', () => {
  const text = formatCiStatus({
    ref: 'forge/repair-1',
    sha: 'abcdef1234567890',
    state: 'failure',
    checkRuns: [
      { name: 'tests', status: 'completed', conclusion: 'failure' },
      { name: 'lint', status: 'completed', conclusion: 'success' }
    ]
  });
  assert.match(text, /FAILURE/);
  assert.match(text, /tests/);
  assert.match(text, /does not invoke an AI model/i);
  assert.doesNotMatch(text, /lint\n/);
});

test('Forge build result is bounded and displays model route plus token usage', () => {
  const text = formatForgeResult({
    mode: 'execute',
    status: 'completed',
    repo: 'Khaos-Krew/Khaos-Nexus',
    baseRef: 'rebuild/nexus-0.1',
    branch: 'forge/safe-task-1234567',
    modelRoute: 'openai-primary',
    usage: {
      requests: 4,
      inputTokens: 1200,
      outputTokens: 300,
      totalTokens: 1500
    },
    output: 'x'.repeat(5000)
  });
  assert.ok(text.length <= 1900);
  assert.match(text, /forge\/safe-task-1234567/);
  assert.match(text, /openai-primary/);
  assert.match(text, /1,500 tokens/);
  assert.match(text, /1,200 in \/ 300 out/);
});

test('Forge requests retain explicit no-merge/no-deploy guardrails', () => {
  const constraints = buildConstraints('123');
  assert.ok(constraints.some((item) => /Do not merge/i.test(item)));
  assert.ok(constraints.some((item) => /draft PR/i.test(item)));
  assert.ok(constraints.some((item) => /Do not merge pull requests or deploy production/i.test(item)));
});

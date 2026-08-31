'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  forgeCommand,
  bridgeStatusText,
  formatForgeResult,
  formatCiStatus,
  formatUsage,
  formatQueue,
  formatTask,
  buildConstraints,
  validForgeBranch
} = require('../src/sentinel/forge-extension.cjs');
const { ForgeClient } = require('../src/sentinel/forge-client.cjs');

test('/forge exposes V0.2 control-plane, cost-free CI, plan, guarded build, and repair subcommands', () => {
  const json = forgeCommand().toJSON();
  assert.equal(json.name, 'forge');
  assert.deepEqual(json.options.map((item) => item.name), [
    'status', 'usage', 'queue', 'task', 'approve', 'revoke', 'cancel', 'retry', 'audit', 'ci', 'plan', 'build', 'repair'
  ]);
  for (const name of ['task', 'approve', 'revoke', 'cancel', 'retry']) {
    const command = json.options.find((item) => item.name === name);
    assert.equal(command.options[0].name, 'id');
    assert.equal(command.options[0].required, true);
  }
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

test('Forge status reports V0.2 safety posture using the server workerRuntime contract', () => {
  const client = new ForgeClient({ enabled: true, baseUrl: 'forge.internal:8080', token: 'super-secret-value', defaultRepo: 'Khaos-Krew/Khaos-Nexus', defaultBaseRef: 'rebuild/nexus-0.1', fetchImpl: async () => { throw new Error('unused'); } });
  const text = bridgeStatusText(client, {
    ok: true, version: '0.2.0-infra', openaiConfigured: true, githubConfigured: true, fallbackRouting: 'disabled', writePolicy: 'draft-pr-only'
  }, {
    queue: { queued: 2, waiting: 1, running: 0 },
    approvalGate: 'required-for-durable-model-work',
    workerRuntime: { workerEnabled: true, autonomousDailyTokenBudget: 240000 },
    authority: { forgeCanMerge: false, forgeCanDeploy: false }
  });
  assert.match(text, /V0\.2 Control Plane/);
  assert.match(text, /Worker: \*\*Enabled\*\*/);
  assert.match(text, /Merge authority: \*\*Disabled\*\*/);
  assert.match(text, /Deploy authority: \*\*Disabled\*\*/);
  assert.match(text, /Fallback routing: \*\*disabled\*\*/);
  assert.doesNotMatch(text, /super-secret-value/);
  assert.doesNotMatch(text, /forge\.internal/);
});

test('Forge status falls back cleanly when V0.2 control plane is unavailable', () => {
  const client = new ForgeClient({ enabled: true, baseUrl: 'https://forge.example.test', token: 'secret', fetchImpl: async () => { throw new Error('unused'); } });
  const text = bridgeStatusText(client, { ok: true, version: '0.1.0', openaiConfigured: true, githubConfigured: true, fallbackRouting: 'disabled', writePolicy: 'draft-pr-only' }, null);
  assert.match(text, /backward-compatible runtime surface/i);
});

test('Forge CI text surfaces failures and explicitly identifies no-model checking', () => {
  const text = formatCiStatus({ ref: 'forge/repair-1', sha: 'abcdef1234567890', state: 'failure', checkRuns: [{ name: 'tests', status: 'completed', conclusion: 'failure' }, { name: 'lint', status: 'completed', conclusion: 'success' }] });
  assert.match(text, /FAILURE/);
  assert.match(text, /tests/);
  assert.match(text, /does not invoke an AI model/i);
});

test('Forge V0.2 queue, task and usage formatters are bounded and zero-token explicit', () => {
  const usage = formatUsage({ totals: { tasks: 2, requests: 3, inputTokens: 1000, outputTokens: 200, totalTokens: 1200 } });
  assert.match(usage, /1,200/);
  assert.match(usage, /0 model tokens/i);
  const queue = formatQueue({ tasks: [{ id: 'task-a', state: 'waiting', mode: 'plan', goal: 'Inspect a CI failure safely.' }] });
  assert.match(queue, /task-a/);
  assert.match(queue, /WAITING/);
  assert.match(queue, /0 model tokens/i);
  const detail = formatTask({ task: { id: 'task-a', state: 'queued', mode: 'plan', repo: 'Khaos-Krew/Khaos-Nexus', baseRef: 'rebuild/nexus-0.1', attempt: 0, maxAttempts: 2, goal: 'x'.repeat(3000) }, approval: null });
  assert.ok(detail.length <= 1900);
  assert.match(detail, /NOT GRANTED/);
  assert.match(detail, /0 model tokens/i);
});

test('Forge build result is bounded and displays model route plus token usage', () => {
  const text = formatForgeResult({ mode: 'execute', status: 'completed', repo: 'Khaos-Krew/Khaos-Nexus', baseRef: 'rebuild/nexus-0.1', branch: 'forge/safe-task-1234567', modelRoute: 'openai-primary', usage: { requests: 4, inputTokens: 1200, outputTokens: 300, totalTokens: 1500 }, output: 'x'.repeat(5000) });
  assert.ok(text.length <= 1900);
  assert.match(text, /forge\/safe-task-1234567/);
  assert.match(text, /openai-primary/);
  assert.match(text, /1,500 tokens/);
});

test('Forge requests retain explicit no-merge/no-deploy guardrails', () => {
  const constraints = buildConstraints('123');
  assert.ok(constraints.some((item) => /Do not merge/i.test(item)));
  assert.ok(constraints.some((item) => /draft PR/i.test(item)));
  assert.ok(constraints.some((item) => /Do not merge pull requests or deploy production/i.test(item)));
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_PROBES, ProviderValidator } = require('../src/backend/core/provider-validator.cjs');

function runtimeFor(moduleId, options = {}) {
  const manifest = {
    id: moduleId,
    enabled: options.enabled !== false,
    configured: options.configured !== false,
    providerKind: options.providerKind || 'test-provider',
    availableActions: options.availableActions || [DEFAULT_PROBES[moduleId]].filter(Boolean)
  };
  const calls = [];
  return {
    calls,
    manifests: () => [manifest],
    invoke: async (id, actionId, payload, context) => {
      calls.push({ id, actionId, payload, context });
      return options.result || { ok: true, moduleId: id, actionId, data: { sample: true } };
    }
  };
}

test('Palworld live validation uses status only with viewer access and no confirmation', async () => {
  const runtime = runtimeFor('palworld');
  const validator = new ProviderValidator({ runtime });
  const result = await validator.validate('palworld');
  assert.equal(result.summary.passed, 1);
  assert.equal(result.results[0].code, 'LIVE_VALIDATED');
  assert.deepEqual(runtime.calls.map((call) => call.actionId), ['status']);
  assert.equal(runtime.calls[0].context.role, 'viewer');
  assert.equal(runtime.calls[0].context.confirmed, false);
});

test('validation skips disabled and unconfigured providers without invoking them', async () => {
  const disabled = runtimeFor('palworld', { enabled: false });
  const disabledResult = await new ProviderValidator({ runtime: disabled }).validate('palworld');
  assert.equal(disabledResult.results[0].code, 'MODULE_DISABLED');
  assert.equal(disabled.calls.length, 0);

  const missing = runtimeFor('palworld', { configured: false });
  const missingResult = await new ProviderValidator({ runtime: missing }).validate('palworld');
  assert.equal(missingResult.results[0].code, 'PROVIDER_NOT_CONFIGURED');
  assert.equal(missing.calls.length, 0);
});

test('validation reports provider failures without returning provider payload data', async () => {
  const runtime = runtimeFor('palworld', { result: { ok: false, code: 'PROVIDER_ERROR', message: 'authentication failed\nsecret output should not be returned' } });
  const result = await new ProviderValidator({ runtime }).validate('palworld');
  assert.equal(result.summary.failed, 1);
  assert.equal(result.results[0].ok, false);
  assert.equal(Object.hasOwn(result.results[0], 'data'), false);
  assert.match(result.results[0].message, /authentication failed/);
  assert.equal(result.results[0].message.includes('\n'), false);
});

test('all default probes map to non-destructive viewer capabilities', () => {
  const { getModule } = require('../src/backend/modules/catalog.cjs');
  for (const [moduleId, actionId] of Object.entries(DEFAULT_PROBES)) {
    const capability = getModule(moduleId)?.capabilities.find((item) => item.id === actionId);
    assert.ok(capability, `${moduleId}.${actionId} must exist`);
    assert.equal(capability.requiredRole, 'viewer', `${moduleId}.${actionId} must remain viewer-only`);
    assert.equal(capability.destructive, false, `${moduleId}.${actionId} must remain non-destructive`);
  }
});

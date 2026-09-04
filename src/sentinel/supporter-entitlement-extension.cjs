'use strict';

const { Client } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { rankAuthority } = require('../shared/ranks.cjs');
const { createCoalescingRunner } = require('./coalescing-runner.cjs');
const { reconcileSupporterEntitlements } = require('./supporter-entitlement-adapter.cjs');
const { registerStartupTask, startupDiagnostics } = require('./startup-coordinator.cjs');

const INSTALLED = Symbol.for('khaos.nexus.supporterEntitlement.extension');
const BOUND = Symbol.for('khaos.nexus.supporterEntitlement.bound');
const RUNTIME = Symbol.for('khaos.nexus.supporterEntitlement.runtime');
const STARTUP_TASK_ID = 'supporter-entitlement-sync';
const INITIAL_DELAY_MS = 45_000;
const PERIODIC_SYNC_MS = 30 * 60_000;
const ENTITLEMENT_EVENTS = Object.freeze(['entitlementCreate', 'entitlementUpdate', 'entitlementDelete']);

function premiumEntitlementAuthority(config = {}) {
  return rankAuthority(config) === 'premium-app';
}

function supporterSyncSummary(result = {}) {
  if (result.reason === 'server-shop-roles-authoritative') return 'authority=server-shop-roles skipped=true';
  if (result.ok === false) return `ok=false reason=${String(result.reason || 'unavailable').slice(0, 120)}`;
  return [
    'ok=true',
    `pages=${Number(result.pages || 0)}`,
    `users=${Array.isArray(result.users) ? result.users.length : 0}`,
    `changes=${Number(result.changed || 0)}`,
    `failures=${Number(result.failures || 0)}`,
    `guildOnly=${Array.isArray(result.guildEntitlements) ? result.guildEntitlements.length : 0}`,
    `truncated=${Boolean(result.truncated)}`
  ].join(' ');
}

async function runSupporterEntitlementSync(client, config = {}, options = {}) {
  if (!premiumEntitlementAuthority(config)) {
    return {
      ok: true,
      reason: 'server-shop-roles-authoritative',
      users: [],
      guildEntitlements: [],
      changed: 0,
      failures: 0,
      pages: 0,
      truncated: false
    };
  }
  const guildId = String(config.discord?.guildId || '').trim();
  if (!guildId) return { ok: false, reason: 'guild-not-configured', users: [], changed: 0, failures: 0 };
  const guild = await client.guilds.fetch(guildId);
  return reconcileSupporterEntitlements(client, guild, config, {
    includeStaleMembers: options.includeStaleMembers !== false
  });
}

function ensureSupporterRuntime(client, config) {
  if (client[RUNTIME]) return client[RUNTIME];
  const runner = createCoalescingRunner(async (reason) => {
    const result = await runSupporterEntitlementSync(client, config, { includeStaleMembers: true });
    console.log(`[Nexus Sentinal] supporter entitlement reconciliation (${reason}): ${supporterSyncSummary(result)}`);
    for (const item of result.users || []) {
      if (item.ok === false) {
        console.warn(`[Nexus Sentinal] supporter entitlement member warning: user=${item.userId || 'unknown'} reason=${item.reason || 'unknown'}`);
      }
    }
  }, {
    onError(error, reason) {
      console.warn(`[Nexus Sentinal] supporter entitlement reconciliation (${reason}) unavailable: ${String(error?.message || error).slice(0, 240)}`);
    }
  });
  client[RUNTIME] = { runner, initial: null, periodic: null };
  return client[RUNTIME];
}

function startSupporterEntitlementMonitor(client, config, { setTimeoutFn = setTimeout, setIntervalFn = setInterval } = {}) {
  const runtime = ensureSupporterRuntime(client, config);
  if (!premiumEntitlementAuthority(config)) {
    console.log('[Nexus Sentinal] supporter entitlement reconciliation: authority=server-shop-roles skipped=true');
    return runtime;
  }
  if (!runtime.initial) {
    runtime.initial = setTimeoutFn(() => void runtime.runner.request('startup'), INITIAL_DELAY_MS);
    runtime.initial?.unref?.();
  }
  if (!runtime.periodic) {
    runtime.periodic = setIntervalFn(() => void runtime.runner.request('periodic'), PERIODIC_SYNC_MS);
    runtime.periodic?.unref?.();
  }
  return runtime;
}

function installSupporterEntitlementExtension() {
  if (Client.prototype[INSTALLED]) return { installed: false };
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusSupporterEntitlementLogin(...args) {
    const client = this;
    const runtime = ensureSupporterRuntime(client, config);
    if (!client[BOUND]) {
      client[BOUND] = true;
      for (const eventName of ENTITLEMENT_EVENTS) {
        client.on(eventName, () => {
          if (!premiumEntitlementAuthority(config)) return;
          void runtime.runner.request(eventName);
        });
      }
    }
    return originalLogin.apply(client, args);
  };

  if (!startupDiagnostics().tasks.some((task) => task.id === STARTUP_TASK_ID)) {
    registerStartupTask({
      id: STARTUP_TASK_ID,
      owner: 'supporter-entitlements',
      priority: 160,
      run(client) {
        startSupporterEntitlementMonitor(client, config);
      }
    });
  }
  return { installed: true, coordinated: true };
}

module.exports = {
  STARTUP_TASK_ID,
  INITIAL_DELAY_MS,
  PERIODIC_SYNC_MS,
  ENTITLEMENT_EVENTS,
  premiumEntitlementAuthority,
  supporterSyncSummary,
  runSupporterEntitlementSync,
  ensureSupporterRuntime,
  startSupporterEntitlementMonitor,
  installSupporterEntitlementExtension
};

'use strict';

const { Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { rankAuthority } = require('../shared/ranks.cjs');
const { createCoalescingRunner } = require('./coalescing-runner.cjs');
const { reconcileSupporterEntitlements } = require('./supporter-entitlement-adapter.cjs');

const INSTALLED = Symbol.for('khaos.nexus.supporterEntitlement.extension');
const BOUND = Symbol.for('khaos.nexus.supporterEntitlement.bound');
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

function installSupporterEntitlementExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusSupporterEntitlementLogin(...args) {
    const client = this;
    if (!client[BOUND]) {
      client[BOUND] = true;
      let runner = null;
      const request = (reason) => runner?.request(reason);

      client.once(Events.ClientReady, () => {
        runner = createCoalescingRunner(async (reason) => {
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

        if (!premiumEntitlementAuthority(config)) {
          console.log('[Nexus Sentinal] supporter entitlement reconciliation: authority=server-shop-roles skipped=true');
          return;
        }

        const initial = setTimeout(() => void request('startup'), INITIAL_DELAY_MS);
        initial.unref?.();
        const periodic = setInterval(() => void request('periodic'), PERIODIC_SYNC_MS);
        periodic.unref?.();
      });

      for (const eventName of ENTITLEMENT_EVENTS) {
        client.on(eventName, () => {
          if (!premiumEntitlementAuthority(config)) return;
          void request(eventName);
        });
      }
    }
    return originalLogin.apply(client, args);
  };
}

module.exports = {
  INITIAL_DELAY_MS,
  PERIODIC_SYNC_MS,
  ENTITLEMENT_EVENTS,
  premiumEntitlementAuthority,
  supporterSyncSummary,
  runSupporterEntitlementSync,
  installSupporterEntitlementExtension
};

'use strict';

const { Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { createCoalescingRunner } = require('./coalescing-runner.cjs');
const { effectiveRankConfig } = require('./effective-rank-config.cjs');
const { StateStore } = require('./state-store.cjs');
const { reconcileSupporterHubCategory } = require('./supporter-hub-policy.cjs');

const INSTALLED = Symbol.for('khaos.nexus.supporterHub.extension');
const BOUND = Symbol.for('khaos.nexus.supporterHub.bound');
const INITIAL_DELAY_MS = 60_000;
const PERIODIC_RECONCILE_MS = 5 * 60_000;

function supporterHubSummary(result = {}) {
  if (result.skipped) return `ok=false skipped=true reason=${String(result.reason || 'unknown').slice(0, 120)}`;
  return [
    `ok=${result.ok !== false}`,
    `category=${String(result.categoryId || 'unknown')}`,
    `roles=${Array.isArray(result.visibleRoleIds) ? result.visibleRoleIds.length : 0}`,
    `missingPaid=${Array.isArray(result.missingPaidRanks) ? result.missingPaidRanks.length : 0}`,
    `founder=${Boolean(result.founderConfigured)}`,
    `warnings=${Array.isArray(result.warnings) ? result.warnings.length : 0}`
  ].join(' ');
}

async function runSupporterHubReconcile(client, config = {}, options = {}) {
  const effective = effectiveRankConfig(config, options.state || options.adminSettings || null);
  const guildId = String(effective.discord?.guildId || '').trim();
  if (!guildId) return { ok: false, skipped: true, reason: 'guild-not-configured', changed: 0, warnings: [] };
  const guild = await client.guilds.fetch(guildId);
  return reconcileSupporterHubCategory(guild, effective, { botId: client.user?.id });
}

function installSupporterHubExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const state = new StateStore();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusSupporterHubLogin(...args) {
    const client = this;
    if (!client[BOUND]) {
      client[BOUND] = true;
      let runner = null;
      const request = (reason) => runner?.request(reason);

      client.once(Events.ClientReady, () => {
        runner = createCoalescingRunner(async (reason) => {
          const result = await runSupporterHubReconcile(client, config, { state });
          console.log(`[Nexus Sentinal] Supporter Hub reconciliation (${reason}): ${supporterHubSummary(result)}`);
          for (const warning of result.warnings || []) {
            console.warn(`[Nexus Sentinal] Supporter Hub warning (${reason}): ${String(warning).slice(0, 240)}`);
          }
        }, {
          onError(error, reason) {
            console.warn(`[Nexus Sentinal] Supporter Hub reconciliation (${reason}) unavailable: ${String(error?.message || error).slice(0, 240)}`);
          }
        });
        const initial = setTimeout(() => void request('startup'), INITIAL_DELAY_MS);
        initial.unref?.();
        const periodic = setInterval(() => void request('periodic'), PERIODIC_RECONCILE_MS);
        periodic.unref?.();
      });

      client.on(Events.GuildRoleCreate, () => void request('role-create'));
      client.on(Events.GuildRoleDelete, () => void request('role-delete'));
      client.on(Events.GuildRoleUpdate, () => void request('role-update'));
    }
    return originalLogin.apply(client, args);
  };
}

module.exports = {
  INITIAL_DELAY_MS,
  PERIODIC_RECONCILE_MS,
  supporterHubSummary,
  runSupporterHubReconcile,
  installSupporterHubExtension
};

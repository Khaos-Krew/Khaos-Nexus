'use strict';

const { Client, Events } = require('discord.js');
const { ArkIdentityStore } = require('./ark-identity-store.cjs');
const { NexusEconomyClient } = require('./nexus-economy-client.cjs');

const INSTALLED = Symbol.for('khaos.nexus.economy.identity.sync.installed');
const PROJECTION_HOOK_INSTALLED = Symbol.for('khaos.nexus.economy.identity.projection.hook.installed');
const INITIAL_DELAY_MS = 15_000;
const SYNC_MS = Math.max(60_000, Number(process.env.NEXUS_ECONOMY_IDENTITY_SYNC_SECONDS || 300) * 1000 || 300_000);

function clean(value, max = 256) {
  return String(value || '').replace(/[\r\n\t\u0000-\u001f]+/g, '').trim().slice(0, max);
}

async function projectProfileToEconomy(profile, { economyClient = new NexusEconomyClient(), rankId = '' } = {}) {
  if (!economyClient.configured()) return { ok: false, skipped: 'economy-worker-unconfigured', linked: 0 };
  const discordUserId = clean(profile?.discordUserId, 32);
  if (!/^\d{5,25}$/.test(discordUserId)) return { ok: false, skipped: 'discord-user-id-invalid', linked: 0 };
  const resolvedRankId = clean(rankId || profile?.rankId, 48) || 'shadow-recruit';
  let linked = 0;
  for (const account of profile?.arkAccounts || []) {
    const eosId = clean(account?.eosId, 128);
    if (!eosId) continue;
    await economyClient.linkIdentity({ discordUserId, eosId, rankId: resolvedRankId });
    linked += 1;
  }
  return { ok: true, discordUserId, rankId: resolvedRankId, linked };
}

function installIdentityProjectionHooks({
  IdentityStoreClass = ArkIdentityStore,
  economyClientFactory = () => new NexusEconomyClient(),
  logger = console
} = {}) {
  const prototype = IdentityStoreClass?.prototype;
  if (!prototype || prototype[PROJECTION_HOOK_INSTALLED]) return false;
  const originalVerifyChallenge = prototype.verifyChallenge;
  const originalUpdateRank = prototype.updateRank;
  if (typeof originalVerifyChallenge !== 'function' || typeof originalUpdateRank !== 'function') return false;

  Object.defineProperty(prototype, PROJECTION_HOOK_INSTALLED, { value: true, configurable: false, enumerable: false });

  const project = (result, source) => {
    if (!result?.ok || !result?.profile) return;
    let economyClient;
    try { economyClient = economyClientFactory(); } catch (error) {
      logger.warn?.(`[Nexus Economy] ${source} projection client unavailable: ${clean(error?.message || error, 180)}`);
      return;
    }
    Promise.resolve(projectProfileToEconomy(result.profile, { economyClient }))
      .catch((error) => logger.warn?.(`[Nexus Economy] ${source} projection failed discord=${clean(result.profile?.discordUserId, 32)}: ${clean(error?.message || error, 180)}`));
  };

  prototype.verifyChallenge = function nexusEconomyProjectedVerifyChallenge(...args) {
    const result = originalVerifyChallenge.apply(this, args);
    project(result, 'account-link');
    return result;
  };

  prototype.updateRank = function nexusEconomyProjectedUpdateRank(...args) {
    const result = originalUpdateRank.apply(this, args);
    project(result, 'rank-sync');
    return result;
  };

  return true;
}

async function syncVerifiedIdentities({ identityStore = new ArkIdentityStore(), economyClient = new NexusEconomyClient(), logger = console } = {}) {
  if (!economyClient.configured()) return { skipped: 'economy-worker-unconfigured' };
  const state = identityStore.read();
  let linked = 0;
  let failed = 0;
  for (const [discordUserId, profileRaw] of Object.entries(state.profiles || {})) {
    const profile = { ...profileRaw, discordUserId: profileRaw?.discordUserId || discordUserId };
    for (const account of profile.arkAccounts || []) {
      try {
        await economyClient.linkIdentity({
          discordUserId,
          eosId: account.eosId,
          rankId: profile.rankId || 'shadow-recruit'
        });
        linked += 1;
      } catch (error) {
        failed += 1;
        logger.warn?.(`[Nexus Economy] identity sync failed discord=${discordUserId}: ${clean(error?.message || error, 180)}`);
      }
    }
  }
  return { ok: failed === 0, linked, failed };
}

function installNexusEconomyIdentitySyncExtension() {
  installIdentityProjectionHooks();
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function nexusEconomyIdentitySyncLogin(...args) {
    const client = this;
    client.once(Events.ClientReady, () => {
      const economyClient = new NexusEconomyClient();
      if (!economyClient.configured()) {
        console.log('[Nexus Economy] identity sync disabled: economy worker is not configured.');
        return;
      }
      let running = false;
      const run = async (reason) => {
        if (running) return;
        running = true;
        try {
          const result = await syncVerifiedIdentities({ economyClient });
          console.log(`[Nexus Economy] identity sync ${reason}: linked=${result.linked || 0} failed=${result.failed || 0}`);
        } catch (error) {
          console.warn(`[Nexus Economy] identity sync ${reason} unavailable: ${clean(error?.message || error, 240)}`);
        } finally { running = false; }
      };
      const initial = setTimeout(() => void run('startup'), INITIAL_DELAY_MS);
      initial.unref?.();
      const periodic = setInterval(() => void run('periodic'), SYNC_MS);
      periodic.unref?.();
    });
    return originalLogin.apply(client, args);
  };
}

module.exports = {
  INITIAL_DELAY_MS,
  SYNC_MS,
  projectProfileToEconomy,
  installIdentityProjectionHooks,
  syncVerifiedIdentities,
  installNexusEconomyIdentitySyncExtension
};

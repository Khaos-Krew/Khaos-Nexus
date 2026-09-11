'use strict';

const { Client, Events } = require('discord.js');
const { ArkIdentityStore } = require('./ark-identity-store.cjs');
const { NexusEconomyClient } = require('./nexus-economy-client.cjs');

const INSTALLED = Symbol.for('khaos.nexus.economy.identity.sync.installed');
const INITIAL_DELAY_MS = 15_000;
const SYNC_MS = Math.max(60_000, Number(process.env.NEXUS_ECONOMY_IDENTITY_SYNC_SECONDS || 300) * 1000 || 300_000);

async function syncVerifiedIdentities({ identityStore = new ArkIdentityStore(), economyClient = new NexusEconomyClient(), logger = console } = {}) {
  if (!economyClient.configured()) return { skipped: 'economy-worker-unconfigured' };
  const state = identityStore.read();
  const profiles = Object.entries(state.profiles || {}).map(([discordUserId, profile]) => ({
    discordUserId, rankId: profile.rankId || 'shadow-recruit', eosIds: (profile.arkAccounts || []).map(account => account.eosId)
  }));
  return economyClient.syncIdentities({ profiles, observedAt: new Date().toISOString() });
}

function installNexusEconomyIdentitySyncExtension() {
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
          console.warn(`[Nexus Economy] identity sync ${reason} unavailable: ${String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 240)}`);
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

module.exports = { INITIAL_DELAY_MS, SYNC_MS, syncVerifiedIdentities, installNexusEconomyIdentitySyncExtension };

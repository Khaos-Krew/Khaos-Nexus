'use strict';

const { Client, Events } = require('discord.js');
const { ArkIdentityStore } = require('./ark-identity-store.cjs');
const { NexusEconomyClient } = require('./nexus-economy-client.cjs');
const { withIdentityProof } = require('./nexus-economy-identity-proof.cjs');

const INSTALLED = Symbol.for('khaos.nexus.economy.identity.sync.installed');
const INITIAL_DELAY_MS = 15_000;
const SYNC_MS = Math.max(60_000, Number(process.env.NEXUS_ECONOMY_IDENTITY_SYNC_SECONDS || 300) * 1000 || 300_000);

async function syncVerifiedIdentities({ identityStore = new ArkIdentityStore(), economyClient = new NexusEconomyClient(), logger = console } = {}) {
  if (!economyClient.configured()) return { skipped: 'economy-worker-unconfigured' };
  const state = identityStore.read();
  let linked = 0;
  let failed = 0;
  for (const [discordUserId, profile] of Object.entries(state.profiles || {})) {
    for (const account of profile.arkAccounts || []) {
      try {
        await economyClient.linkIdentity(withIdentityProof({
          discordUserId,
          eosId: account.eosId,
          rankId: profile.rankId || 'shadow-recruit'
        }, account));
        linked += 1;
      } catch (error) {
        failed += 1;
        logger.warn?.(`[Nexus Economy] identity sync failed discord=${discordUserId}: ${String(error?.message || error).slice(0, 180)}`);
      }
    }
  }
  return { ok: failed === 0, linked, failed };
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

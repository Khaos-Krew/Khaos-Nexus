'use strict';

const { Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');

const INSTALLED = Symbol.for('khaos.nexus.onboardingAuthority.extension');
const BOUND = Symbol.for('khaos.nexus.onboardingAuthority.bound');

function sentinalOwnsOnboarding(config = {}) {
  return config?.discord?.sentinalOwnsOnboarding !== false;
}

function collectionSize(value) {
  if (!value) return 0;
  if (Number.isFinite(Number(value.size))) return Number(value.size);
  if (Array.isArray(value)) return value.length;
  if (typeof value.values === 'function') return [...value.values()].length;
  return 0;
}

async function reconcileOnboardingAuthority(guild, config = {}, logger = console) {
  if (!sentinalOwnsOnboarding(config)) {
    return { ok: true, authority: 'discord', nativeEnabled: null, changed: false, defaultChannels: 0, prompts: 0 };
  }
  if (!guild || typeof guild.fetchOnboarding !== 'function' || typeof guild.editOnboarding !== 'function') {
    return { ok: false, authority: 'sentinal', nativeEnabled: null, changed: false, defaultChannels: 0, prompts: 0, reason: 'onboarding-api-unavailable' };
  }

  const onboarding = await guild.fetchOnboarding();
  const defaultChannels = collectionSize(onboarding?.defaultChannels);
  const prompts = collectionSize(onboarding?.prompts);
  if (!onboarding?.enabled) {
    return { ok: true, authority: 'sentinal', nativeEnabled: false, changed: false, defaultChannels, prompts };
  }

  await guild.editOnboarding({ enabled: false, reason: 'Nexus Sentinal: preserve Shadow Recruit+ gated community access' });
  logger.warn?.('[Nexus Sentinal] disabled native Discord Community Onboarding; Sentinal #welcome/#roles flow is authoritative.');
  return { ok: true, authority: 'sentinal', nativeEnabled: false, changed: true, defaultChannels, prompts };
}

function installOnboardingAuthorityExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusOnboardingAuthorityLogin(...args) {
    const client = this;
    if (!client[BOUND]) {
      client[BOUND] = true;
      client.once(Events.ClientReady, () => {
        const run = async () => {
          const guildId = String(config?.discord?.guildId || '').trim();
          if (!guildId) return;
          const guild = await client.guilds.fetch(guildId);
          const result = await reconcileOnboardingAuthority(guild, config);
          console.log(`[Nexus Sentinal] onboarding authority: authority=${result.authority} nativeEnabled=${String(result.nativeEnabled)} changed=${result.changed} defaults=${result.defaultChannels} prompts=${result.prompts} ok=${result.ok}${result.reason ? ` reason=${result.reason}` : ''}`);
        };
        void run().catch((error) => {
          console.warn(`[Nexus Sentinal] onboarding authority unavailable: ${String(error?.message || error).slice(0, 240)}`);
        });
      });
    }
    return originalLogin.apply(client, args);
  };
}

module.exports = { collectionSize, sentinalOwnsOnboarding, reconcileOnboardingAuthority, installOnboardingAuthorityExtension };

'use strict';

const { loadConfig } = require('../shared/config.cjs');
const { registerStartupTask, startupDiagnostics } = require('./startup-coordinator.cjs');

const STARTUP_TASK_ID = 'onboarding-authority';

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

function onboardingNeedsDetachment(onboarding) {
  return Boolean(onboarding?.enabled)
    || collectionSize(onboarding?.defaultChannels) > 0
    || collectionSize(onboarding?.prompts) > 0;
}

async function reconcileOnboardingAuthority(guild, config = {}, logger = console) {
  if (!sentinalOwnsOnboarding(config)) {
    return {
      ok: true,
      authority: 'discord',
      nativeEnabled: null,
      changed: false,
      defaultChannels: 0,
      prompts: 0,
      clearedDefaultChannels: 0,
      clearedPrompts: 0
    };
  }
  if (!guild || typeof guild.fetchOnboarding !== 'function' || typeof guild.editOnboarding !== 'function') {
    return {
      ok: false,
      authority: 'sentinal',
      nativeEnabled: null,
      changed: false,
      defaultChannels: 0,
      prompts: 0,
      clearedDefaultChannels: 0,
      clearedPrompts: 0,
      reason: 'onboarding-api-unavailable'
    };
  }

  const onboarding = await guild.fetchOnboarding();
  const defaultChannels = collectionSize(onboarding?.defaultChannels);
  const prompts = collectionSize(onboarding?.prompts);
  if (!onboardingNeedsDetachment(onboarding)) {
    return {
      ok: true,
      authority: 'sentinal',
      nativeEnabled: false,
      changed: false,
      defaultChannels,
      prompts,
      clearedDefaultChannels: 0,
      clearedPrompts: 0
    };
  }

  await guild.editOnboarding({
    enabled: false,
    defaultChannels: [],
    prompts: [],
    reason: 'Nexus Sentinal: detach native onboarding from Shadow Recruit+ gated community channels'
  });
  logger.log?.(`[Nexus Sentinal] detached native Discord Community Onboarding: defaultsCleared=${defaultChannels} promptsCleared=${prompts}; Sentinal #welcome/#roles flow is authoritative.`);
  return {
    ok: true,
    authority: 'sentinal',
    nativeEnabled: false,
    changed: true,
    defaultChannels: 0,
    prompts: 0,
    clearedDefaultChannels: defaultChannels,
    clearedPrompts: prompts
  };
}

async function runOnboardingAuthority(client, config) {
  const guildId = String(config?.discord?.guildId || '').trim();
  if (!guildId) return { skipped: 'guild-not-configured' };
  const guild = await client.guilds.fetch(guildId);
  const result = await reconcileOnboardingAuthority(guild, config);
  console.log(`[Nexus Sentinal] onboarding authority: authority=${result.authority} nativeEnabled=${String(result.nativeEnabled)} changed=${result.changed} defaults=${result.defaultChannels} prompts=${result.prompts} clearedDefaults=${result.clearedDefaultChannels || 0} clearedPrompts=${result.clearedPrompts || 0} ok=${result.ok}${result.reason ? ` reason=${result.reason}` : ''}`);
  return result;
}

function installOnboardingAuthorityExtension() {
  if (startupDiagnostics().tasks.some((task) => task.id === STARTUP_TASK_ID)) return { installed: false, coordinated: true };
  const config = loadConfig();
  registerStartupTask({
    id: STARTUP_TASK_ID,
    owner: 'discord-onboarding',
    priority: 110,
    async run(client) {
      try {
        await runOnboardingAuthority(client, config);
      } catch (error) {
        console.warn(`[Nexus Sentinal] onboarding authority unavailable: ${String(error?.message || error).slice(0, 240)}`);
      }
    }
  });
  return { installed: true, coordinated: true };
}

module.exports = {
  STARTUP_TASK_ID,
  collectionSize,
  sentinalOwnsOnboarding,
  onboardingNeedsDetachment,
  reconcileOnboardingAuthority,
  runOnboardingAuthority,
  installOnboardingAuthorityExtension
};

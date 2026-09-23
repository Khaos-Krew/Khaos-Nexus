'use strict';

const { replyEphemeral, reportCommandFailure, setGameBotMeta, BOT_LABELS } = require('./command-failure.cjs');

// Owner-provided Discord category IDs. Env overrides win; a blank var keeps
// the documented default. A non-snowflake override fail-closes the gate.
// Sanctuary has no owner category. Blank SANCTUARY_DISCORD_CATEGORY_ID and
// DIABLO_DISCORD_CATEGORY_ID leave that gate open and log a warning.
const OWNER_CATEGORY_IDS = Object.freeze({
  ascended: '1516602943670059108',
  cephalon: '1516640233389822042'
});

const CATEGORY_ENV_NAMES = Object.freeze({
  ascended: 'ASCENDED_DISCORD_CATEGORY_ID',
  cephalon: 'CEPHALON_DISCORD_CATEGORY_ID',
  sanctuary: 'SANCTUARY_DISCORD_CATEGORY_ID'
});

// Used only when the primary variable is unset or blank.
const CATEGORY_ENV_ALIASES = Object.freeze({
  sanctuary: 'DIABLO_DISCORD_CATEGORY_ID'
});

const GATE = Symbol.for('khaos.nexus.gamebot.categoryGate');
const WRAPPED = Symbol.for('khaos.nexus.gamebot.categoryWrapped');
const DECISION = Symbol.for('khaos.nexus.gamebot.categoryDecision');
const DENIED = Symbol.for('khaos.nexus.gamebot.categoryDenied');
const THREAD_TYPES = new Set([10, 11, 12]);

function normalizeBot(value) {
  const bot = String(value || '').trim().toLowerCase();
  if (bot === 'ascended' || bot === 'ark_asa' || bot === 'nexus-ascended') return 'ascended';
  if (bot === 'cephalon' || bot === 'warframe' || bot === 'cephalon-nexus') return 'cephalon';
  if (bot === 'sanctuary' || bot === 'diablo' || bot === 'diablo4' || bot === 'sanctuary-nexus') return 'sanctuary';
  return '';
}

function gameBotKey({ botKey, gameRole, serviceName } = {}) {
  return normalizeBot(botKey) || normalizeBot(gameRole) || normalizeBot(serviceName);
}

function categoryRaw(key, env) {
  const envName = CATEGORY_ENV_NAMES[key] || '';
  const aliasName = CATEGORY_ENV_ALIASES[key] || '';
  const primary = envName ? env[envName] : undefined;
  if (primary !== undefined && String(primary).trim() !== '') {
    return { envName, raw: String(primary).trim() };
  }
  const alias = aliasName ? env[aliasName] : undefined;
  if (alias !== undefined && String(alias).trim() !== '') {
    return { envName: aliasName, raw: String(alias).trim() };
  }
  return { envName, raw: '' };
}

function resolveCategoryConfig(bot, env = process.env) {
  const key = normalizeBot(bot);
  const envName = CATEGORY_ENV_NAMES[key] || '';
  const fallback = OWNER_CATEGORY_IDS[key] || '';
  if (!key) return { bot: '', id: '', source: 'invalid', envName, failClosed: true, open: false };
  const reading = categoryRaw(key, env);
  if (!reading.raw) {
    if (fallback) return { bot: key, id: fallback, source: 'default', envName: reading.envName, failClosed: false, open: false };
    return { bot: key, id: '', source: 'unset', envName: reading.envName, failClosed: false, open: true };
  }
  if (!/^\d{17,20}$/.test(reading.raw)) {
    return { bot: key, id: '', source: 'invalid', envName: reading.envName, failClosed: true, open: false };
  }
  return { bot: key, id: reading.raw, source: 'env', envName: reading.envName, failClosed: false, open: false };
}

function redirectMessage(bot) {
  const key = normalizeBot(bot);
  if (key === 'ascended') return 'Use this bot in the ARK Ascended category.';
  if (key === 'sanctuary') return 'Use this bot in the Sanctuary category.';
  return 'Use this bot in the Warframe category.';
}

function isThreadChannel(channel) {
  if (!channel) return false;
  if (typeof channel.isThread === 'function') return Boolean(channel.isThread());
  return THREAD_TYPES.has(Number(channel.type));
}

async function categoryIdForInteraction(interaction) {
  if (!interaction?.guildId) return '';
  let channel = interaction.channel || null;
  if (!channel && interaction.channelId && typeof interaction.guild?.channels?.fetch === 'function') {
    channel = await interaction.guild.channels.fetch(interaction.channelId).catch(() => null);
  }
  if (!channel) return '';
  if (!isThreadChannel(channel)) return String(channel.parentId || '');
  let parent = channel.parent || null;
  if (!parent && channel.parentId && typeof interaction.guild?.channels?.fetch === 'function') {
    parent = await interaction.guild.channels.fetch(channel.parentId).catch(() => null);
  }
  return String(parent?.parentId || '');
}

async function evaluateCategoryAccess(interaction, config) {
  if (config?.open) return { allow: true, categoryId: '', reason: 'open' };
  if (!config?.id) return { allow: false, categoryId: '', reason: 'fail-closed' };
  const categoryId = await categoryIdForInteraction(interaction);
  if (!categoryId) return { allow: false, categoryId: '', reason: interaction?.guildId ? 'no-category' : 'dm' };
  if (categoryId !== String(config.id)) return { allow: false, categoryId, reason: 'wrong-category' };
  return { allow: true, categoryId, reason: 'allow' };
}

function decisionFor(interaction, config) {
  if (!interaction[DECISION]) interaction[DECISION] = evaluateCategoryAccess(interaction, config);
  return interaction[DECISION];
}

function isInteractionEvent(event) {
  return event === 'interactionCreate';
}

function installCategoryGate(client, { bot, env = process.env } = {}) {
  const key = normalizeBot(bot);
  if (!client || client[GATE] || !key) return client;
  client[GATE] = true;
  const config = resolveCategoryConfig(key, env);
  setGameBotMeta(client, { bot: key, botName: BOT_LABELS[key] });
  if (config.failClosed) {
    console.error(`[${BOT_LABELS[key]}] category gate fail-closed: ${config.envName} is not a Discord category id`);
  } else if (config.open) {
    console.warn(`[${BOT_LABELS[key]}] category gate open: ${config.envName} is unset; commands are allowed until a category id is provided`);
  }

  function wrap(listener) {
    if (typeof listener !== 'function' || listener[WRAPPED]) return listener;
    const wrapped = async function nexusCategoryGate(interaction) {
      const decision = await decisionFor(interaction, config);
      if (!decision.allow) {
        if (!interaction[DENIED]) {
          interaction[DENIED] = true;
          await replyEphemeral(interaction, redirectMessage(key));
        }
        return;
      }
      try {
        return await listener.call(this, interaction);
      } catch (error) {
        await reportCommandFailure(interaction, error, { bot: key, botName: BOT_LABELS[key], env });
      }
    };
    wrapped[WRAPPED] = true;
    return wrapped;
  }

  function route(original) {
    return function categoryGatedOn(event, listener) {
      const next = isInteractionEvent(event) ? wrap(listener) : listener;
      return original.call(this, event, next);
    };
  }

  if (typeof client.on === 'function') client.on = route(client.on);
  if (typeof client.addListener === 'function') client.addListener = route(client.addListener);
  if (typeof client.once === 'function') client.once = route(client.once);
  if (typeof client.prependListener === 'function') client.prependListener = route(client.prependListener);
  return client;
}

module.exports = {
  OWNER_CATEGORY_IDS,
  CATEGORY_ENV_NAMES,
  CATEGORY_ENV_ALIASES,
  normalizeBot,
  gameBotKey,
  resolveCategoryConfig,
  redirectMessage,
  isThreadChannel,
  categoryIdForInteraction,
  evaluateCategoryAccess,
  installCategoryGate
};

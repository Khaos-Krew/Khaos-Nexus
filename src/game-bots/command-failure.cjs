'use strict';

const { MessageFlags } = require('discord.js');

const PLAYER_FAILURE_MESSAGE = 'Something went wrong running that command. Staff have been notified.';
const GAME_BOT_META = Symbol.for('khaos.nexus.gamebot.meta');
const BOT_LABELS = Object.freeze({
  cephalon: 'Cephalon Nexus',
  ascended: 'Nexus Ascended'
});
const STAFF_CHANNEL_NAMES = Object.freeze(['staff-ops', 'staff-hub', 'ark-ops', 'server-ops', 'ark-server-status']);

function setGameBotMeta(client, meta = {}) {
  if (!client) return null;
  const bot = meta.bot === 'ascended' ? 'ascended' : meta.bot === 'cephalon' ? 'cephalon' : '';
  client[GAME_BOT_META] = Object.freeze({
    bot,
    botName: safeBotName(meta.botName || bot)
  });
  return client[GAME_BOT_META];
}

function gameBotMeta(client) {
  return client?.[GAME_BOT_META] || null;
}

function safeBotName(value) {
  const text = String(value || '');
  if (text === BOT_LABELS.cephalon || text === BOT_LABELS.ascended) return text;
  if (text === 'cephalon') return BOT_LABELS.cephalon;
  if (text === 'ascended') return BOT_LABELS.ascended;
  return 'Game bot';
}

function errorClass(error) {
  const name = String(error?.name || 'Error').replace(/[^A-Za-z0-9_]/g, '');
  const safe = (name || 'Error').slice(0, 48);
  const code = Number(error?.code);
  if (Number.isInteger(code) && code > 0 && code < 1000000) return `${safe}:${code}`;
  return safe;
}

function redactSecrets(value) {
  return String(value || '')
    .replace(/[a-z][a-z0-9+.-]*:\/\/\S+/gi, '[redacted-url]')
    .replace(/\b(password|passwd|token|secret|api[_-]?key)\b\s*[:=]\s*\S+/gi, '$1=[redacted]')
    .replace(/\b[MN][A-Za-z\d]{23}\.[\w-]{6}\.[\w-]{27}\b/g, '[redacted-token]');
}

function safeUserId(interaction) {
  const digits = String(interaction?.user?.id || '').replace(/\D/g, '');
  return digits.slice(0, 20) || 'unknown';
}

function safeCommandLabel(interaction) {
  const name = String(interaction?.commandName || '').toLowerCase();
  if (/^[a-z0-9_-]{1,32}$/.test(name)) return `/${name}`;
  const custom = String(interaction?.customId || '');
  if (/^[A-Za-z0-9:_-]{1,40}$/.test(custom)) return custom.slice(0, 40);
  return 'interaction';
}

function cachedChannels(client) {
  const cache = client?.channels?.cache;
  if (!cache) return [];
  if (typeof cache.values === 'function') return [...cache.values()];
  if (Array.isArray(cache)) return cache;
  return [];
}

async function resolveStaffChannel(client, env = process.env) {
  const explicit = String(env.NEXUS_STAFF_ALERT_CHANNEL_ID || '').trim();
  if (explicit) {
    if (!/^\d{17,20}$/.test(explicit)) return null;
    if (typeof client?.channels?.fetch === 'function') {
      return client.channels.fetch(explicit).catch(() => null);
    }
    return cachedChannels(client).find((channel) => String(channel?.id || '') === explicit) || null;
  }
  const names = new Set(STAFF_CHANNEL_NAMES);
  return cachedChannels(client).find((channel) => names.has(String(channel?.name || '').toLowerCase()) && typeof channel.send === 'function') || null;
}

function staffAlertText({ botName, commandLabel, userId, failureClass }) {
  return redactSecrets([
    '**Command failure**',
    `Bot: ${safeBotName(botName)}`,
    `Command: ${commandLabel}`,
    `User: ${userId}`,
    `Class: ${failureClass}`
  ].join('\n')).slice(0, 1800);
}

async function replyEphemeral(interaction, content) {
  const payload = { content: String(content || '').slice(0, 500), allowedMentions: { parse: [] } };
  if (typeof interaction?.isAutocomplete === 'function' && interaction.isAutocomplete()) {
    if (!interaction.responded) await interaction.respond?.([]).catch(() => {});
    return;
  }
  if (interaction?.deferred || interaction?.replied) {
    await interaction.editReply?.(payload).catch(async () => {
      await interaction.followUp?.({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
    });
    return;
  }
  await interaction.reply?.({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
}

async function reportCommandFailure(interaction, error, options = {}) {
  const env = options.env || process.env;
  const meta = gameBotMeta(interaction?.client) || {};
  const botName = safeBotName(options.botName || meta.botName || options.bot || meta.bot);
  const commandLabel = safeCommandLabel(interaction);
  const userId = safeUserId(interaction);
  const failureClass = errorClass(error);
  try {
    await replyEphemeral(interaction, PLAYER_FAILURE_MESSAGE);
    const text = staffAlertText({ botName, commandLabel, userId, failureClass });
    const channel = await resolveStaffChannel(interaction?.client, env);
    if (channel && typeof channel.send === 'function') {
      await channel.send({ content: text, allowedMentions: { parse: [] } });
      return { delivered: true, failureClass, commandLabel, userId };
    }
    console.warn(`[${botName}] staff alert undelivered: command=${commandLabel} user=${userId} class=${failureClass}`);
    return { delivered: false, failureClass, commandLabel, userId };
  } catch (alertError) {
    console.warn(`[${botName}] staff alert failed: class=${errorClass(alertError)}`);
    return { delivered: false, failureClass, commandLabel, userId };
  }
}

module.exports = {
  PLAYER_FAILURE_MESSAGE,
  GAME_BOT_META,
  BOT_LABELS,
  STAFF_CHANNEL_NAMES,
  setGameBotMeta,
  gameBotMeta,
  safeBotName,
  errorClass,
  redactSecrets,
  safeUserId,
  safeCommandLabel,
  resolveStaffChannel,
  staffAlertText,
  replyEphemeral,
  reportCommandFailure
};

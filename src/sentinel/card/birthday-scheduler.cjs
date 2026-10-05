'use strict';

const { readBirthdayCoins, birthdayEnabled, BIRTHDAY_POLICY } = require('./birthday-config.cjs');
const { cardEnabled } = require('./card-config.cjs');
const { runBirthdayPass } = require('./birthday-service.cjs');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { mentionSafe } = require('./birthday-copy.cjs');

const TIMER = Symbol.for('khaos.nexus.playerCard.birthdayTimer');

function revealButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('card:bday:reveal').setLabel('Reveal').setStyle(ButtonStyle.Primary)
  );
}

function schedulerDecision(env = process.env) {
  if (!cardEnabled(env) || !birthdayEnabled(env)) return { ok: false, reason: 'flag-off' };
  const coins = readBirthdayCoins(env);
  if (!coins.ok) return { ok: false, reason: coins.reason };
  return { ok: true, intervalMs: BIRTHDAY_POLICY.schedulerMs, coins };
}

function startBirthdayScheduler(deps = {}, options = {}) {
  const env = options.env || deps.env || process.env;
  const decision = schedulerDecision(env);
  if (!decision.ok) return decision;
  const host = options.host || deps;
  if (host[TIMER]) return { ok: true, already: true, intervalMs: decision.intervalMs };
  const run = options.runPass || (() => runBirthdayPass({ ...deps, env }));
  const setIntervalFn = options.setInterval || setInterval;
  Promise.resolve()
    .then(() => run())
    .catch((error) => {
      console.warn(`[Player Card] birthday catch-up failed: ${String(error?.message || error).slice(0, 180)}`);
    });
  const timer = setIntervalFn(() => {
    Promise.resolve()
      .then(() => run())
      .catch((error) => {
        console.warn(`[Player Card] birthday pass failed: ${String(error?.message || error).slice(0, 180)}`);
      });
  }, decision.intervalMs);
  timer.unref?.();
  host[TIMER] = timer;
  return { ok: true, intervalMs: decision.intervalMs, timer };
}

function stopBirthdayScheduler(host = {}) {
  const timer = host[TIMER];
  if (timer) clearInterval(timer);
  delete host[TIMER];
}

function attachBirthdayDelivery(client, deps = {}) {
  const env = deps.env || process.env;
  const config = deps.config || {};
  const guildId = String(config.discord?.guildId || '').trim();
  return {
    ...deps,
    env,
    async loadMember(userId) {
      if (!guildId) return null;
      const guild = await client.guilds.fetch(guildId);
      return guild.members.fetch(String(userId));
    },
    async deliverPrivate(userId, payload) {
      const user = await client.users.fetch(String(userId));
      const body = mentionSafe({ content: payload.content });
      if (payload.reveal) body.components = [revealButton()];
      await user.send(body);
    },
    async deliverChannel(payload) {
      const channelId = String(env.BIRTHDAY_CHANNEL_ID || '').trim();
      if (!channelId) throw new Error('birthday-channel-unset');
      const channel = await client.channels.fetch(channelId);
      await channel.send(mentionSafe({ content: payload.content }));
    },
    async alertStaff(payload) {
      const channelId = String(env.BIRTHDAY_STAFF_ALERT_CHANNEL_ID || '').trim();
      if (!channelId) {
        console.warn('[Player Card] birthday staff alert channel is unset. The present was deferred.');
        return;
      }
      const channel = await client.channels.fetch(channelId);
      await channel.send(mentionSafe({
        content: `${payload.content} Member ${payload.userId}.`
      }));
    }
  };
}

module.exports = {
  TIMER,
  revealButton,
  schedulerDecision,
  startBirthdayScheduler,
  stopBirthdayScheduler,
  attachBirthdayDelivery
};

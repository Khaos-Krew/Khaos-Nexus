'use strict';

const { Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { resolveChannel } = require('./ark-staff-status-monitor-extension.cjs');
const { inspectNexusBankHealth } = require('./ark-nexus-bank-health-monitor.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.bank.health.extension');
const INITIAL_DELAY_MS = 15_000;
const INTERVAL_MS = 5 * 60_000;

function discordPayload(alert) {
  if (!alert) return null;
  const fields = [];
  if (alert.state === 'healthy' && alert.counts) {
    fields.push({
      name: 'Nexus Bank Store',
      value: `Accounts: **${alert.counts.accountCount}** • Transactions: **${alert.counts.transactionCount}** • Store version: **${alert.counts.version}**`,
      inline: false
    });
  } else if (alert.code) {
    fields.push({ name: 'Fail-closed code', value: `\`${String(alert.code).slice(0, 80)}\``, inline: false });
  }
  return {
    embeds: [{
      title: alert.title,
      description: alert.description,
      fields,
      footer: { text: 'Nexus Sentinal • Nexus Bank Health • read-only monitoring' },
      timestamp: new Date().toISOString()
    }],
    allowedMentions: { parse: [] }
  };
}

async function runNexusBankHealthCycle(client, config, options = {}) {
  const result = inspectNexusBankHealth(options);
  const state = result.current.ok ? 'healthy' : result.current.code;
  if (!result.changed || !result.alert) return { changed: false, state };

  const guildId = String(config?.discord?.guildId || '');
  if (!guildId) return { changed: true, delivered: false, reason: 'guild-not-configured', state };
  const guild = await client.guilds.fetch(guildId);
  const channel = await resolveChannel(guild);
  if (!channel) return { changed: true, delivered: false, reason: 'staff-channel-not-found', state };
  await channel.send(discordPayload(result.alert));
  return { changed: true, delivered: true, channelId: String(channel.id), state };
}

function installNexusBankHealthExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function nexusBankHealthLogin(...args) {
    const client = this;
    client.once(Events.ClientReady, () => {
      const run = () => void runNexusBankHealthCycle(client, config).catch(() => {});
      const initial = setTimeout(run, INITIAL_DELAY_MS);
      initial.unref?.();
      const timer = setInterval(run, INTERVAL_MS);
      timer.unref?.();
    });
    return originalLogin.apply(this, args);
  };
}

module.exports = { discordPayload, runNexusBankHealthCycle, installNexusBankHealthExtension };
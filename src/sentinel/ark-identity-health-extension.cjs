'use strict';

const { Client, Events } = require('discord.js');
const { loadConfig } = require('../shared/config.cjs');
const { resolveChannel } = require('./ark-staff-status-monitor-extension.cjs');
const { inspectIdentityHealth } = require('./ark-identity-health-monitor.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.identity.health.extension');
const INITIAL_DELAY_MS = 12_000;
const INTERVAL_MS = 5 * 60_000;

function discordPayload(alert) {
  if (!alert) return null;
  const fields = [];
  if (alert.state === 'healthy' && alert.counts) {
    fields.push({
      name: 'Identity Store',
      value: `Profiles: **${alert.counts.profiles}** • Linked ARK accounts: **${alert.counts.linkedArkAccounts}** • Pending challenges: **${alert.counts.pendingChallenges}**`,
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
      footer: { text: 'Nexus Sentinal • ARK Identity Health • read-only monitoring' },
      timestamp: new Date().toISOString()
    }],
    allowedMentions: { parse: [] }
  };
}

async function runIdentityHealthCycle(client, config, options = {}) {
  const result = inspectIdentityHealth(options);
  if (!result.changed || !result.alert) return { changed: false, state: result.current.ok ? 'healthy' : result.current.code };

  const guildId = String(config?.discord?.guildId || '');
  if (!guildId) return { changed: true, delivered: false, reason: 'guild-not-configured', state: result.current.ok ? 'healthy' : result.current.code };
  const guild = await client.guilds.fetch(guildId);
  const channel = await resolveChannel(guild);
  if (!channel) return { changed: true, delivered: false, reason: 'staff-channel-not-found', state: result.current.ok ? 'healthy' : result.current.code };
  const payload = discordPayload(result.alert);
  await channel.send(payload);
  return { changed: true, delivered: true, channelId: String(channel.id), state: result.current.ok ? 'healthy' : result.current.code };
}

function installArkIdentityHealthExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const originalLogin = Client.prototype.login;
  Client.prototype.login = function nexusArkIdentityHealthLogin(...args) {
    const client = this;
    client.once(Events.ClientReady, () => {
      const run = () => void runIdentityHealthCycle(client, config).catch(() => {});
      const initial = setTimeout(run, INITIAL_DELAY_MS);
      initial.unref?.();
      const timer = setInterval(run, INTERVAL_MS);
      timer.unref?.();
    });
    return originalLogin.apply(this, args);
  };
}

module.exports = { discordPayload, runIdentityHealthCycle, installArkIdentityHealthExtension };

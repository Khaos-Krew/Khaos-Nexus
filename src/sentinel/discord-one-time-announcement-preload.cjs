'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Client, Events } = require('discord.js');

const originalLogin = Client.prototype.login;
let installed = false;

function clean(value) {
  return String(value || '').trim();
}

function decodeEscapedNewlines(value) {
  return clean(value).replace(/\\n/g, '\n');
}

function enabled() {
  return /^(1|true|yes|on)$/i.test(clean(process.env.NEXUS_DISCORD_ANNOUNCE_ONCE));
}

function stampFile(key) {
  const safe = clean(key).replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 120) || 'default';
  return path.join('/app/data', `discord-announcement-${safe}.json`);
}

async function resolveRoleMention(client, roleName) {
  const requested = clean(roleName);
  if (!requested) return '';
  const guildId = clean(process.env.NEXUS_DISCORD_GUILD_ID);
  if (!guildId) throw new Error('NEXUS_DISCORD_GUILD_ID is empty while resolving announcement role mention');
  const guild = await client.guilds.fetch(guildId);
  const roles = await guild.roles.fetch();
  const role = roles.find((item) => clean(item?.name).toLowerCase() === requested.toLowerCase());
  if (!role) throw new Error(`Discord role not found by exact name: ${requested}`);
  return `<@&${role.id}>`;
}

async function deletePreviousMessage(channel, messageId) {
  const id = clean(messageId);
  if (!id) return;
  try {
    const message = await channel.messages.fetch(id);
    await message.delete();
    console.log(`[Nexus Sentinal] replaced previous Discord announcement: message=${id}`);
  } catch (error) {
    console.warn(`[Nexus Sentinal] previous Discord announcement could not be removed: message=${id} error=${String(error?.message || error).slice(0, 300)}`);
  }
}

async function postOnce(client) {
  if (!enabled()) return;

  const channelId = clean(process.env.NEXUS_DISCORD_ANNOUNCE_CHANNEL_ID);
  const key = clean(process.env.NEXUS_DISCORD_ANNOUNCE_KEY) || 'nexus-protocol-teaser-v1';
  const rawContent = decodeEscapedNewlines(process.env.NEXUS_DISCORD_ANNOUNCE_CONTENT);
  const title = decodeEscapedNewlines(process.env.NEXUS_DISCORD_ANNOUNCE_TITLE) || 'NEXUS PROTOCOL // SIGNAL DETECTED';
  const description = decodeEscapedNewlines(process.env.NEXUS_DISCORD_ANNOUNCE_DESCRIPTION);
  const footer = decodeEscapedNewlines(process.env.NEXUS_DISCORD_ANNOUNCE_FOOTER) || 'Khaos Nexus • Nexus Sentinal';
  const roleName = clean(process.env.NEXUS_DISCORD_ANNOUNCE_ROLE_NAME);
  const replaceMessageId = clean(process.env.NEXUS_DISCORD_ANNOUNCE_REPLACE_MESSAGE_ID);
  const stamp = stampFile(key);

  if (!channelId) {
    console.warn('[Nexus Sentinal] one-time Discord announcement skipped: NEXUS_DISCORD_ANNOUNCE_CHANNEL_ID is empty');
    return;
  }
  if (fs.existsSync(stamp)) {
    console.log(`[Nexus Sentinal] one-time Discord announcement already sent: key=${key}`);
    return;
  }

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel?.isTextBased?.()) throw new Error(`channel ${channelId} is not text-capable`);

    const roleMention = await resolveRoleMention(client, roleName);
    const content = [roleMention, rawContent].filter(Boolean).join('\n').slice(0, 2000);
    const payload = { allowedMentions: { roles: roleMention ? [roleMention.slice(3, -1)] : [], parse: [] } };
    if (content) payload.content = content;
    if (description) {
      payload.embeds = [{
        title: title.slice(0, 256),
        description: description.slice(0, 4096),
        footer: { text: footer.slice(0, 2048) },
        timestamp: new Date().toISOString()
      }];
    }
    if (!payload.content && !payload.embeds) throw new Error('announcement content and description are both empty');

    await deletePreviousMessage(channel, replaceMessageId);
    const message = await channel.send(payload);
    fs.mkdirSync(path.dirname(stamp), { recursive: true });
    fs.writeFileSync(stamp, JSON.stringify({ key, channelId, messageId: String(message.id), roleName, sentAt: new Date().toISOString() }, null, 2));
    console.log(`[Nexus Sentinal] one-time Discord announcement sent: key=${key} channel=${channelId} message=${message.id} role=${roleName || 'none'}`);
  } catch (error) {
    console.error(`[Nexus Sentinal] one-time Discord announcement failed: key=${key} channel=${channelId} error=${String(error?.message || error).slice(0, 700)}`);
  }
}

if (!installed) {
  installed = true;
  Client.prototype.login = function patchedLogin(...args) {
    this.once(Events.ClientReady, () => {
      require('./nexus-protocol-announcement.cjs').updateProtocolAnnouncement(this)
        .catch((error) => console.error(`[Nexus Protocol] banner update failed: ${error.message}`));
    });
    this.once(Events.ClientReady, () => void postOnce(this));
    return originalLogin.apply(this, args);
  };
}

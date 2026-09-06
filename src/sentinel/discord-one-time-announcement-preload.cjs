'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Client, Events } = require('discord.js');

const originalLogin = Client.prototype.login;
let installed = false;

function clean(value) {
  return String(value || '').trim();
}

function enabled() {
  return /^(1|true|yes|on)$/i.test(clean(process.env.NEXUS_DISCORD_ANNOUNCE_ONCE));
}

function stampFile(key) {
  const safe = clean(key).replace(/[^a-zA-Z0-9_.-]+/g, '-').slice(0, 120) || 'default';
  return path.join('/app/data', `discord-announcement-${safe}.json`);
}

async function postOnce(client) {
  if (!enabled()) return;

  const channelId = clean(process.env.NEXUS_DISCORD_ANNOUNCE_CHANNEL_ID);
  const key = clean(process.env.NEXUS_DISCORD_ANNOUNCE_KEY) || 'nexus-protocol-teaser-v1';
  const content = clean(process.env.NEXUS_DISCORD_ANNOUNCE_CONTENT);
  const title = clean(process.env.NEXUS_DISCORD_ANNOUNCE_TITLE) || 'NEXUS PROTOCOL // SIGNAL DETECTED';
  const description = clean(process.env.NEXUS_DISCORD_ANNOUNCE_DESCRIPTION);
  const footer = clean(process.env.NEXUS_DISCORD_ANNOUNCE_FOOTER) || 'Khaos Nexus • Nexus Sentinal';
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

    const payload = {};
    if (content) payload.content = content.slice(0, 2000);
    if (description) {
      payload.embeds = [{
        title: title.slice(0, 256),
        description: description.slice(0, 4096),
        footer: { text: footer.slice(0, 2048) },
        timestamp: new Date().toISOString()
      }];
    }
    if (!payload.content && !payload.embeds) throw new Error('announcement content and description are both empty');

    const message = await channel.send(payload);
    fs.mkdirSync(path.dirname(stamp), { recursive: true });
    fs.writeFileSync(stamp, JSON.stringify({ key, channelId, messageId: String(message.id), sentAt: new Date().toISOString() }, null, 2));
    console.log(`[Nexus Sentinal] one-time Discord announcement sent: key=${key} channel=${channelId} message=${message.id}`);
  } catch (error) {
    console.error(`[Nexus Sentinal] one-time Discord announcement failed: key=${key} channel=${channelId} error=${String(error?.message || error).slice(0, 700)}`);
  }
}

if (!installed) {
  installed = true;
  Client.prototype.login = function patchedLogin(...args) {
    this.once(Events.ClientReady, () => void postOnce(this));
    return originalLogin.apply(this, args);
  };
}

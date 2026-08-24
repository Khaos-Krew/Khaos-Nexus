'use strict';

const API = 'https://discord.com/api/v10';
const token = String(process.env.NEXUS_SENTINEL_TOKEN || process.env.NEXUS_SENTINAL_TOKEN || '').trim();
const guildId = String(process.env.NEXUS_DISCORD_GUILD_ID || '').trim();
const channelName = 'ark-tame-info';
const categoryName = 'ARK Survival Ascended';
const categoryAliases = new Set(['ark', 'ark asa', 'asa', 'ark ascended', 'ark survival ascended']);

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function discord(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      authorization: `Bot ${token}`,
      'content-type': 'application/json',
      'user-agent': 'Khaos-Nexus-Sentinal/0.1',
      ...(init.headers || {})
    }
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Discord API ${response.status} ${response.statusText}: ${text.slice(0, 500)}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

async function createChannel(payload, reason) {
  return discord(`/guilds/${guildId}/channels`, {
    method: 'POST',
    headers: { 'x-audit-log-reason': encodeURIComponent(reason) },
    body: JSON.stringify(payload)
  });
}

async function main() {
  if (!/^\d{15,24}$/.test(guildId)) throw new Error('NEXUS_DISCORD_GUILD_ID is missing or invalid.');
  if (!token) throw new Error('NEXUS_SENTINEL_TOKEN is missing.');

  let channels = await discord(`/guilds/${guildId}/channels`);
  let category = channels.find((channel) => channel.type === 4 && categoryAliases.has(normalize(channel.name)));
  if (!category) {
    category = await createChannel({ name: categoryName, type: 4 }, 'Nexus Sentinal: ensure ARK category for tame info');
    console.log(`[Nexus deploy] created ARK category ${category.id}`);
    channels = await discord(`/guilds/${guildId}/channels`);
  }

  const existing = channels.find((channel) => channel.type === 0 && channel.parent_id === category.id && channel.name === channelName);
  if (existing) {
    console.log(`[Nexus deploy] #${channelName} already exists under ${category.name} (${existing.id})`);
    return;
  }

  const created = await createChannel({
    name: channelName,
    type: 0,
    parent_id: category.id,
    topic: 'Nexus Sentinal ARK taming calculator, KO requirements, food rankings, and tame planning.'
  }, 'Nexus Sentinal: create dedicated ARK tame info channel');
  console.log(`[Nexus deploy] created #${channelName} under ${category.name} (${created.id})`);
}

main().catch((error) => {
  console.error('[Nexus deploy] ARK tame info channel provisioning failed:', error.message);
  process.exitCode = 1;
});

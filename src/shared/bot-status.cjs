'use strict';

// One status line per bot. Each one can be changed with an env var, e.g.
// NEXUS_STATUS_SENTINAL="Watching over the Nexus ⚔️". Set it to "off" to clear it.
const DEFAULT_STATUS = Object.freeze({
  sentinal: 'Watching over the Nexus ⚔️',
  cephalon: 'Scanning the Origin System',
  ascended: 'Taming chaos on the Ark 🦖',
  sanctuary: 'Hunting demons in Sanctuary 🔥',
  vanguard: 'Forming fireteams for the Vanguard',
  craft: 'Building worlds in the Nexus ⛏️'
});

const MAX_LENGTH = 128;
const CUSTOM_ACTIVITY = 4; // ActivityType.Custom

function statusEnvName(bot) {
  return `NEXUS_STATUS_${String(bot || '').toUpperCase()}`;
}

function resolveStatusText(bot, env = process.env) {
  const key = String(bot || '').toLowerCase();
  const raw = env[statusEnvName(key)];
  if (raw !== undefined && String(raw).trim() !== '') {
    const text = String(raw).trim();
    if (text.toLowerCase() === 'off') return '';
    return text.slice(0, MAX_LENGTH);
  }
  return DEFAULT_STATUS[key] || '';
}

function applyBotStatus(client, bot, env = process.env) {
  const text = resolveStatusText(bot, env);
  try {
    if (!client?.user?.setPresence) return { applied: false, reason: 'no-user' };
    client.user.setPresence({
      status: 'online',
      activities: text ? [{ name: 'Custom Status', state: text, type: CUSTOM_ACTIVITY }] : []
    });
    return { applied: true, text };
  } catch (error) {
    console.warn(`[Nexus Status] ${bot} status not set: ${error?.name || 'Error'}`);
    return { applied: false, reason: 'error' };
  }
}

module.exports = { DEFAULT_STATUS, statusEnvName, resolveStatusText, applyBotStatus };

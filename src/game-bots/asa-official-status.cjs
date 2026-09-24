'use strict';

const path = require('node:path');
const { MessageFlags } = require('discord.js');
const { TtlCache } = require('./ttl-cache.cjs');
const { readJson, runtimeDataDir, upsertEmbed, writeJson } = require('./panel-message.cjs');
const { errorClass } = require('./command-failure.cjs');

const OFFICIAL_STATUS_URL = 'https://cdn2.arkdedicated.com/asa/officialserverstatus.ini';

function stripArkMl(value) {
  return String(value || '')
    .replace(/<RichColor\b[^>]*>/gi, '')
    .replace(/<\/>/g, '')
    .replace(/<[^>\n]{0,200}>/g, '');
}

function parseOfficialStatus(raw) {
  const text = stripArkMl(raw).replace(/\u0000/g, '');
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith(';') && !line.startsWith('#'));
  let statusLine = '';
  for (const line of lines) {
    const match = /^(?:serverstatus|status)\s*=\s*(.+)$/i.exec(line);
    if (match) statusLine = match[1].trim();
  }
  if (!statusLine) statusLine = lines.filter((line) => !/^\[[^\]]+\]$/.test(line)).join(' ');
  const compact = statusLine.replace(/\s+/g, ' ').trim().slice(0, 240);
  const versionMatch = /\bv\s*(\d+(?:\.\d+){1,3})\b/i.exec(compact);
  let online = null;
  if (/\boffline\b/i.test(compact)) online = false;
  else if (/\bonline\b/i.test(compact)) online = true;
  return { online, version: versionMatch ? versionMatch[1] : '', summary: compact || 'Status unavailable.' };
}

function officialEmbed(parsed, fetchedAt = new Date().toISOString()) {
  const state = parsed.online === true ? 'Online' : parsed.online === false ? 'Offline' : 'Unknown';
  return {
    title: 'Official ASA Network',
    description: parsed.summary || 'Status unavailable.',
    fields: [
      { name: 'Network', value: state, inline: true },
      { name: 'Version', value: parsed.version ? `v${parsed.version}` : 'not listed', inline: true }
    ],
    footer: { text: `Wildcard CDN • officialserverstatus.ini • ${fetchedAt.slice(0, 19)}Z` },
    color: parsed.online === false ? 0xb42318 : 0x1f7a4d
  };
}

function cacheTtl(env = process.env) {
  const raw = Number(env.ASCENDED_OFFICIAL_STATUS_CACHE_MS);
  if (!Number.isFinite(raw) || raw <= 0) return 120_000;
  return Math.max(60_000, Math.min(10 * 60_000, Math.round(raw)));
}

async function fetchOfficialStatus(fetchImpl = globalThis.fetch, url = OFFICIAL_STATUS_URL) {
  if (typeof fetchImpl !== 'function') throw new Error('Official status fetch is unavailable.');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  timer.unref?.();
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'text/plain', 'user-agent': 'Khaos-Nexus/0.1 ASA status' },
      signal: controller.signal
    });
    if (!response.ok) throw Object.assign(new Error('Official status request failed.'), { code: `HTTP_${response.status}` });
    const body = await response.text();
    return parseOfficialStatus(body.slice(0, 20_000));
  } finally {
    clearTimeout(timer);
  }
}

function statusCacheFor(context, env) {
  if (context.officialCache) return context.officialCache;
  context.officialCache = new TtlCache({
    ttlMs: cacheTtl(env),
    load: () => fetchOfficialStatus(context.fetchImpl, context.officialUrl || OFFICIAL_STATUS_URL)
  });
  return context.officialCache;
}

async function refreshOfficialPanel(context, env, embed) {
  const channelId = String(env.ASCENDED_OFFICIAL_STATUS_CHANNEL_ID || '').trim();
  if (!/^\d{17,20}$/.test(channelId)) return { pinned: false, reason: 'unset' };
  const file = path.join(context.dir || runtimeDataDir(env), 'ascended-official-panel.json');
  const saved = readJson(file, { messageId: '' });
  const result = await upsertEmbed(context.client, channelId, saved.messageId, { embeds: [embed] });
  if (result.messageId) writeJson(file, { messageId: result.messageId });
  return result;
}

async function handleOfficialCommand(interaction, context) {
  const env = context.env || process.env;
  const loaded = await statusCacheFor(context, env).get();
  const embed = officialEmbed(loaded.value);
  await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
  await refreshOfficialPanel({ ...context, client: context.client || interaction.client }, env, embed).catch((error) => {
    console.warn(`[Nexus Ascended] official panel class=${errorClass(error)}`);
  });
  return true;
}

function startOfficialStatusBoard({ client, env = process.env, fetchImpl } = {}) {
  const channelId = String(env.ASCENDED_OFFICIAL_STATUS_CHANNEL_ID || '').trim();
  if (!/^\d{17,20}$/.test(channelId)) return { stop() {} };
  const context = { client, env, fetchImpl, dir: runtimeDataDir(env) };
  const tick = () => handleOfficialCommand({ reply: async () => {}, client }, context)
    .catch((error) => console.warn(`[Nexus Ascended] official panel class=${errorClass(error)}`));
  const timer = setInterval(tick, cacheTtl(env));
  timer.unref?.();
  void tick();
  return { stop() { clearInterval(timer); } };
}

module.exports = {
  OFFICIAL_STATUS_URL,
  stripArkMl,
  parseOfficialStatus,
  officialEmbed,
  fetchOfficialStatus,
  handleOfficialCommand,
  startOfficialStatusBoard
};

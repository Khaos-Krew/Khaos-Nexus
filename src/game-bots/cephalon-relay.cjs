'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { MessageFlags } = require('discord.js');
const { TtlCache } = require('./ttl-cache.cjs');
const { readJson, runtimeDataDir, upsertEmbed, writeJson } = require('./panel-message.cjs');
const { errorClass } = require('./command-failure.cjs');

const FISSURE_TIERS = Object.freeze(['Lith', 'Meso', 'Neo', 'Axi', 'Requiem', 'Omnia']);
const CYCLE_DEFS = Object.freeze([
  { key: 'cetus', path: 'cetusCycle', label: 'Cetus' },
  { key: 'vallis', path: 'vallisCycle', label: 'Orb Vallis' },
  { key: 'cambion', path: 'cambionCycle', label: 'Cambion Drift' },
  { key: 'earth', path: 'earthCycle', label: 'Earth' }
]);
const WFCD_FOOTER = 'WFCD WarframeStat • api.warframestat.us • cached at least 60s';

function clean(value, max = 80) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function cacheTtl(envValue, fallback = 60_000) {
  const raw = Number(envValue);
  if (!Number.isFinite(raw) || raw <= 0) return fallback;
  return Math.max(60_000, Math.min(15 * 60_000, Math.round(raw)));
}

function providerFor(context) {
  if (context?.provider) return context.provider;
  const { WarframeProvider } = require('../backend/providers/warframe-provider.cjs');
  return new WarframeProvider();
}

function normalizeFissures(data) {
  return (Array.isArray(data) ? data : [])
    .filter((item) => item && item.expired !== true)
    .slice(0, 40)
    .map((item) => ({
      tier: clean(item.tier || 'Other', 24) || 'Other',
      node: clean(item.node || 'Unknown node', 60),
      mission: clean(item.missionType || item.mission || '', 40),
      eta: clean(item.eta || item.expiry || '', 40),
      storm: Boolean(item.isStorm || item.storm),
      hard: Boolean(item.isHard || item.hard)
    }));
}

function groupFissures(rows) {
  const groups = new Map();
  for (const row of normalizeFissures(rows)) {
    const list = groups.get(row.tier) || [];
    const flags = [row.hard ? 'SP' : '', row.storm ? 'Storm' : ''].filter(Boolean).join(' ');
    const detail = [row.node, row.mission, row.eta ? `ends ${row.eta}` : ''].filter(Boolean).join(' · ');
    list.push(flags ? `${detail} · ${flags}` : detail);
    groups.set(row.tier, list);
  }
  const ordered = [];
  for (const tier of FISSURE_TIERS) {
    if (groups.has(tier)) ordered.push({ tier, lines: groups.get(tier) });
  }
  for (const [tier, lines] of groups) {
    if (!FISSURE_TIERS.includes(tier)) ordered.push({ tier, lines });
  }
  return ordered;
}

function fissureEmbed(rows) {
  const groups = groupFissures(rows);
  const fields = groups.slice(0, 12).map((group) => ({
    name: group.tier.slice(0, 256),
    value: group.lines.join('\n').slice(0, 1024) || 'None'
  }));
  return {
    title: 'Fissure Relay Board',
    description: groups.length ? `${groups.reduce((sum, group) => sum + group.lines.length, 0)} open fissures.` : 'No open fissures right now.',
    fields,
    footer: { text: WFCD_FOOTER }
  };
}

function challengeKey(challenge) {
  const id = clean(challenge?.id || '', 40);
  if (/^[A-Za-z0-9_-]{1,40}$/.test(id)) return id;
  return crypto.createHash('sha1').update(`${challenge?.title || ''}\n${challenge?.description || ''}`).digest('hex').slice(0, 12);
}

function normalizeNightwave(data) {
  const season = Number(data?.season);
  const challenges = (Array.isArray(data?.activeChallenges) ? data.activeChallenges : Array.isArray(data?.challenges) ? data.challenges : [])
    .slice(0, 20)
    .map((challenge) => ({
      key: challengeKey(challenge),
      title: clean(challenge?.title || 'Challenge', 80),
      description: clean(challenge?.desc || challenge?.description || '', 180),
      reputation: Number(challenge?.reputation || 0) || 0,
      daily: Boolean(challenge?.isDaily || challenge?.daily),
      elite: Boolean(challenge?.isElite || challenge?.elite),
      eta: clean(challenge?.eta || challenge?.expiry || '', 40)
    }));
  return {
    season: Number.isFinite(season) ? season : 0,
    phase: Number.isFinite(Number(data?.phase)) ? Number(data.phase) : null,
    tag: clean(data?.tag || '', 40),
    eta: clean(data?.eta || data?.expiry || '', 40),
    challenges
  };
}

class NightwaveDesk {
  constructor(dir) {
    this.file = path.join(dir, 'cephalon-nightwave.json');
    this.state = readJson(this.file, { version: 1, seasons: {} });
    if (!this.state.seasons || typeof this.state.seasons !== 'object') this.state.seasons = {};
  }

  isDone(userId, season, key) {
    return Boolean(this.state.seasons[String(season)]?.[String(userId)]?.[String(key)]);
  }

  toggle(userId, season, key) {
    const seasonKey = String(season);
    const userKey = String(userId || '').replace(/\D/g, '').slice(0, 20);
    const challenge = String(key || '').slice(0, 40);
    if (!userKey || !challenge) return false;
    this.state.seasons[seasonKey] ||= {};
    this.state.seasons[seasonKey][userKey] ||= {};
    const next = !this.state.seasons[seasonKey][userKey][challenge];
    if (next) this.state.seasons[seasonKey][userKey][challenge] = true;
    else delete this.state.seasons[seasonKey][userKey][challenge];
    writeJson(this.file, { version: 1, seasons: this.state.seasons });
    return next;
  }
}

function nightwaveEmbed(board, desk, userId) {
  const lines = board.challenges.map((challenge) => {
    const mark = desk.isDone(userId, board.season, challenge.key) ? '✅' : '▫️';
    const meta = [challenge.daily ? 'daily' : '', challenge.elite ? 'elite' : '', challenge.reputation ? `${challenge.reputation} standing` : '', challenge.eta].filter(Boolean).join(' · ');
    return `${mark} **${challenge.title}**${meta ? `\n${meta}` : ''}`;
  });
  const heading = [`Season ${board.season || 'unknown'}`, board.phase != null ? `phase ${board.phase}` : '', board.eta ? `ends ${board.eta}` : ''].filter(Boolean).join(' · ');
  return {
    title: 'Nightwave Challenge Desk',
    description: [heading, '', lines.join('\n\n') || 'No active challenges.'].join('\n').slice(0, 4000),
    footer: { text: `${WFCD_FOOTER} • checklist is local Discord state` }
  };
}

function nightwaveComponents(board, desk, userId) {
  const rows = [];
  for (let index = 0; index < board.challenges.length; index += 5) {
    rows.push({
      type: 1,
      components: board.challenges.slice(index, index + 5).map((challenge) => ({
        type: 2,
        style: desk.isDone(userId, board.season, challenge.key) ? 3 : 2,
        label: `${desk.isDone(userId, board.season, challenge.key) ? 'Done' : 'Mark'}: ${challenge.title}`.slice(0, 80),
        custom_id: `cephalon:nw:${board.season}:${challenge.key}`
      }))
    });
  }
  return rows.slice(0, 5);
}

function normalizeCycle(key, label, data) {
  if (!data || typeof data !== 'object') return { key, label, state: 'unavailable', timeLeft: '', ok: false };
  return {
    key,
    label,
    state: clean(data.state || data.shortString || data.cycle || 'unknown', 40),
    timeLeft: clean(data.timeLeft || data.eta || '', 40),
    ok: true
  };
}

function cycleEmbed(cycles, roles = {}) {
  const lines = cycles.map((cycle) => {
    const left = cycle.timeLeft ? ` · ${cycle.timeLeft}` : '';
    const ping = roles[cycle.key] ? ' · ping role available' : '';
    return `**${cycle.label}:** ${cycle.state}${left}${ping}`;
  });
  return {
    title: 'Open-World Cycle Watch',
    description: lines.join('\n').slice(0, 4000) || 'Cycles are unavailable.',
    footer: { text: WFCD_FOOTER }
  };
}

function parseCycleRoles(env = process.env) {
  const roles = {};
  for (const part of String(env.CEPHALON_CYCLE_ROLES || '').split(',')) {
    const [rawKey, rawId] = part.split(':');
    const key = clean(rawKey, 20).toLowerCase();
    const id = String(rawId || '').trim();
    if (CYCLE_DEFS.some((cycle) => cycle.key === key) && /^\d{17,20}$/.test(id)) roles[key] = id;
  }
  return roles;
}

function cycleComponents(roles) {
  const keys = CYCLE_DEFS.filter((cycle) => roles[cycle.key]);
  if (!keys.length) return [];
  return [{
    type: 1,
    components: keys.map((cycle) => ({
      type: 2,
      style: 1,
      label: `${cycle.label} pings`.slice(0, 80),
      custom_id: `cephalon:cycle:${cycle.key}`
    }))
  }];
}

function fissureCacheFor(context, env) {
  if (context.fissureCache) return context.fissureCache;
  context.fissureCache = new TtlCache({
    ttlMs: cacheTtl(env.CEPHALON_FISSURE_CACHE_MS),
    load: async () => normalizeFissures(await providerFor(context).worldstate('fissures'))
  });
  return context.fissureCache;
}

function nightwaveCacheFor(context, env) {
  if (context.nightwaveCache) return context.nightwaveCache;
  context.nightwaveCache = new TtlCache({
    ttlMs: cacheTtl(env.CEPHALON_NIGHTWAVE_CACHE_MS),
    load: async () => normalizeNightwave(await providerFor(context).worldstate('nightwave'))
  });
  return context.nightwaveCache;
}

function cycleCacheFor(context, env) {
  if (context.cycleCache) return context.cycleCache;
  context.cycleCache = new TtlCache({
    ttlMs: cacheTtl(env.CEPHALON_CYCLE_CACHE_MS),
    load: async () => {
      const provider = providerFor(context);
      const cycles = [];
      for (const def of CYCLE_DEFS) {
        try {
          cycles.push(normalizeCycle(def.key, def.label, await provider.worldstate(def.path)));
        } catch {
          cycles.push(normalizeCycle(def.key, def.label, null));
        }
      }
      return cycles;
    }
  });
  return context.cycleCache;
}

function deskFor(context, env) {
  if (context.nightwaveDesk) return context.nightwaveDesk;
  context.nightwaveDesk = new NightwaveDesk(context.dir || runtimeDataDir(env));
  return context.nightwaveDesk;
}

function ephemeralEmbed(embed, extra = {}) {
  return { embeds: [embed], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] }, ...extra };
}

async function refreshFissurePanel(context, env, embed) {
  const channelId = String(env.CEPHALON_FISSURE_CHANNEL_ID || '').trim();
  if (!/^\d{17,20}$/.test(channelId)) return { pinned: false, reason: 'unset' };
  const file = path.join(context.dir || runtimeDataDir(env), 'cephalon-fissure-panel.json');
  const saved = readJson(file, { messageId: '' });
  const result = await upsertEmbed(context.client, channelId, saved.messageId, { embeds: [embed] });
  if (result.messageId) writeJson(file, { messageId: result.messageId });
  return result;
}

async function handleFissureCommand(interaction, context) {
  const env = context.env || process.env;
  const cache = fissureCacheFor(context, env);
  const loaded = await cache.get();
  const embed = fissureEmbed(loaded.value);
  await interaction.reply(ephemeralEmbed(embed));
  await refreshFissurePanel({ ...context, client: context.client || interaction.client }, env, embed).catch((error) => {
    console.warn(`[Cephalon Nexus] fissure panel class=${errorClass(error)}`);
  });
  return true;
}

async function handleNightwaveCommand(interaction, context) {
  const env = context.env || process.env;
  const loaded = await nightwaveCacheFor(context, env).get();
  const desk = deskFor(context, env);
  const userId = interaction.user?.id;
  const embed = nightwaveEmbed(loaded.value, desk, userId);
  const components = nightwaveComponents(loaded.value, desk, userId);
  await interaction.reply(ephemeralEmbed(embed, { components }));
  return true;
}

async function handleCycleCommand(interaction, context) {
  const env = context.env || process.env;
  const loaded = await cycleCacheFor(context, env).get();
  const roles = context.cycleRoles || parseCycleRoles(env);
  await interaction.reply(ephemeralEmbed(cycleEmbed(loaded.value, roles), { components: cycleComponents(roles) }));
  return true;
}

async function handleCephalonButton(interaction, context) {
  const id = String(interaction.customId || '');
  if (id.startsWith('cephalon:nw:')) return handleNightwaveButton(interaction, context);
  if (id.startsWith('cephalon:cycle:')) return handleCycleButton(interaction, context);
  return false;
}

async function handleNightwaveButton(interaction, context) {
  const match = /^cephalon:nw:(\d+):([A-Za-z0-9_-]{1,40})$/.exec(String(interaction.customId || ''));
  if (!match) {
    await interaction.reply({ content: 'That Nightwave control is not available.', flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return true;
  }
  const env = context.env || process.env;
  const loaded = await nightwaveCacheFor(context, env).get();
  const board = loaded.value;
  if (String(board.season) !== match[1] || !board.challenges.some((challenge) => challenge.key === match[2])) {
    await interaction.reply({ content: 'That challenge is not on the current Nightwave board.', flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return true;
  }
  const desk = deskFor(context, env);
  desk.toggle(interaction.user?.id, board.season, match[2]);
  const embed = nightwaveEmbed(board, desk, interaction.user?.id);
  const components = nightwaveComponents(board, desk, interaction.user?.id);
  if (typeof interaction.update === 'function') await interaction.update({ embeds: [embed], components, allowedMentions: { parse: [] } });
  else await interaction.reply(ephemeralEmbed(embed, { components }));
  return true;
}

async function handleCycleButton(interaction, context) {
  const match = /^cephalon:cycle:(cetus|vallis|cambion|earth)$/.exec(String(interaction.customId || ''));
  const env = context.env || process.env;
  const roles = context.cycleRoles || parseCycleRoles(env);
  if (!match || !roles[match[1]]) {
    await interaction.reply({ content: 'That cycle ping role is not configured.', flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
    return true;
  }
  const roleId = roles[match[1]];
  const cache = interaction.member?.roles?.cache;
  const has = typeof cache?.has === 'function' ? cache.has(roleId) : false;
  if (has) await interaction.member.roles.remove(roleId);
  else await interaction.member.roles.add(roleId);
  await interaction.reply({
    content: has ? 'Cycle pings turned off for that world.' : 'Cycle pings turned on for that world.',
    flags: MessageFlags.Ephemeral,
    allowedMentions: { parse: [] }
  });
  return true;
}

class CycleWatch {
  constructor({ cache, roles = {}, stateFile, send }) {
    this.cache = cache;
    this.roles = roles;
    this.stateFile = stateFile;
    this.send = send;
  }

  readState() {
    const parsed = readJson(this.stateFile, { seeded: false, states: {} });
    return { seeded: parsed.seeded === true, states: parsed.states && typeof parsed.states === 'object' ? parsed.states : {} };
  }

  async tick() {
    const loaded = await this.cache.get();
    const previous = this.readState();
    const states = {};
    const pings = [];
    for (const cycle of loaded.value) {
      states[cycle.key] = cycle.state;
      const before = previous.states[cycle.key];
      if (previous.seeded && before && before !== cycle.state && this.roles[cycle.key]) {
        pings.push({ key: cycle.key, label: cycle.label, state: cycle.state, roleId: this.roles[cycle.key] });
      }
    }
    writeJson(this.stateFile, { seeded: true, states });
    for (const ping of pings) {
      if (typeof this.send === 'function') await this.send(ping);
    }
    return pings;
  }
}

function startCephalonBoards({ client, env = process.env, provider } = {}) {
  const context = { client, env, provider, dir: runtimeDataDir(env) };
  const timers = [];
  const fissureChannel = String(env.CEPHALON_FISSURE_CHANNEL_ID || '').trim();
  if (/^\d{17,20}$/.test(fissureChannel)) {
    const tick = () => handleFissureCommand({
      reply: async () => {},
      client
    }, context).catch((error) => console.warn(`[Cephalon Nexus] fissure board class=${errorClass(error)}`));
    const timer = setInterval(tick, cacheTtl(env.CEPHALON_FISSURE_PANEL_MS, 120_000));
    timer.unref?.();
    timers.push(timer);
    void tick();
  }
  const cycleChannel = String(env.CEPHALON_CYCLE_CHANNEL_ID || '').trim();
  const roles = parseCycleRoles(env);
  if (/^\d{17,20}$/.test(cycleChannel) && Object.keys(roles).length) {
    const watch = new CycleWatch({
      cache: cycleCacheFor(context, env),
      roles,
      stateFile: path.join(context.dir, 'cephalon-cycle-state.json'),
      send: async (ping) => {
        const channel = await client.channels.fetch(cycleChannel);
        await channel.send({
          content: `${ping.label} is now ${ping.state}. <@&${ping.roleId}>`,
          allowedMentions: { parse: [], roles: [ping.roleId] }
        });
      }
    });
    const timer = setInterval(() => {
      void watch.tick().catch((error) => console.warn(`[Cephalon Nexus] cycle watch class=${errorClass(error)}`));
    }, cacheTtl(env.CEPHALON_CYCLE_POLL_MS));
    timer.unref?.();
    timers.push(timer);
    void watch.tick().catch((error) => console.warn(`[Cephalon Nexus] cycle watch class=${errorClass(error)}`));
  }
  return {
    stop() {
      for (const timer of timers) clearInterval(timer);
    }
  };
}

module.exports = {
  FISSURE_TIERS,
  CYCLE_DEFS,
  WFCD_FOOTER,
  normalizeFissures,
  groupFissures,
  fissureEmbed,
  normalizeNightwave,
  NightwaveDesk,
  nightwaveEmbed,
  nightwaveComponents,
  normalizeCycle,
  cycleEmbed,
  parseCycleRoles,
  cycleComponents,
  handleFissureCommand,
  handleNightwaveCommand,
  handleCycleCommand,
  handleCephalonButton,
  CycleWatch,
  startCephalonBoards,
  challengeKey
};

'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { ActionRowBuilder, Events, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { isStaff } = require('./ops-spine.cjs');
const { TtlCache } = require('./ttl-cache.cjs');
const { readJson, runtimeDataDir, snowflake, upsertEmbed, writeJson } = require('./panel-message.cjs');
const { attachBanner } = require('./brand-banners.cjs');
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
  const result = await upsertEmbed(context.client, channelId, saved.messageId, { embeds: [embed] }, {
    panel: 'fissures',
    botId: context.client?.user?.id,
    envMessageId: snowflake(env.CEPHALON_FISSURE_MESSAGE_ID)
  });
  if (result.messageId && result.reason !== 'foreign-unmatched') writeJson(file, { messageId: result.messageId });
  if (result.created || result.migrated || result.duplicatesRemoved || result.foreignRemoved) {
    console.log(`[Cephalon Nexus] fissure panel message=${result.messageId} created=${result.created ? 'yes' : 'no'} migrated=${result.migrated ? 'yes' : 'no'} duplicatesRemoved=${result.duplicatesRemoved || 0} foreignRemoved=${result.foreignRemoved || 0}`);
  }
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
  await interaction.reply(attachBanner('cephalon', ephemeralEmbed(embed, { components })));
  return true;
}

async function handleCycleCommand(interaction, context) {
  const env = context.env || process.env;
  const loaded = await cycleCacheFor(context, env).get();
  const roles = context.cycleRoles || parseCycleRoles(env);
  await interaction.reply(attachBanner('cephalon', ephemeralEmbed(cycleEmbed(loaded.value, roles), { components: cycleComponents(roles) })));
  return true;
}

async function handleCephalonButton(interaction, context) {
  const id = String(interaction.customId || '');
  if (id.startsWith('cephalon:nw:')) return handleNightwaveButton(interaction, context);
  if (id.startsWith('cephalon:cycle:')) return handleCycleButton(interaction, context);
  if (id.startsWith('cephalon:clan:')) return handleClanButton(interaction, context);
  return false;
}

async function handleCephalonModal(interaction, context) {
  const id = String(interaction.customId || '');
  if (!id.startsWith('cephalon:clan:')) return false;
  return handleClanModal(interaction, context);
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
  const next = attachBanner('cephalon', ephemeralEmbed(embed, { components }));
  if (typeof interaction.update === 'function') {
    const { flags, ...update } = next;
    await interaction.update(update);
  } else await interaction.reply(next);
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
  const postClanPanel = () => {
    void refreshClanPanel(context, env).catch((error) => console.warn(`[Cephalon Nexus] clan panel class=${errorClass(error)}`));
  };
  if (typeof client?.isReady === 'function' && client.isReady()) postClanPanel();
  else if (typeof client?.once === 'function') client.once(Events.ClientReady, postClanPanel);
  else postClanPanel();
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

const CLAN_DEFAULTS = Object.freeze({
  channelId: '1552750453287161947',
  memberRoleId: '1552750297732874332',
  officerRoleId: '1552750301625188384'
});

function envSnowflake(env, name, fallback) {
  const raw = env?.[name];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  return snowflake(raw);
}

function clanConfig(env = process.env) {
  return {
    channelId: envSnowflake(env, 'CEPHALON_CLAN_APPLICATIONS_CHANNEL_ID', CLAN_DEFAULTS.channelId),
    memberRoleId: envSnowflake(env, 'CEPHALON_CLAN_MEMBER_ROLE_ID', CLAN_DEFAULTS.memberRoleId),
    officerRoleId: envSnowflake(env, 'CEPHALON_CLAN_OFFICER_ROLE_ID', CLAN_DEFAULTS.officerRoleId)
  };
}

function ephemeralText(content) {
  return { content: String(content || '').slice(0, 1900), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
}

function parseClanCustomId(customId) {
  const match = /^cephalon:clan:(apply|submit|approve|reject)(?::(\d{17,20}))?$/.exec(String(customId || ''));
  if (!match) return null;
  const action = match[1];
  const userId = match[2] || '';
  if ((action === 'approve' || action === 'reject') && !userId) return null;
  if ((action === 'apply' || action === 'submit') && userId) return null;
  return { action, userId };
}

function modalValue(fields, key) {
  if (!fields) return '';
  if (typeof fields.getTextInputValue === 'function') {
    try {
      return fields.getTextInputValue(key);
    } catch {
      return '';
    }
  }
  if (typeof fields.get === 'function') {
    const value = fields.get(key);
    if (value != null) return value;
  }
  return fields[key];
}

function splitPlatformMr(value) {
  const text = clean(value, 40);
  if (!text) return { platform: '', mr: '' };
  if (/^\d{1,2}$/.test(text)) return { platform: '', mr: text };
  const match = /^(.*?)(?:\s+mr\s*|\s+)(\d{1,2})$/i.exec(text);
  if (!match) return { platform: clean(text, 16), mr: '' };
  return { platform: clean(match[1], 16), mr: match[2] };
}

function parseClanApplication(fields = {}) {
  const alias = clean(modalValue(fields, 'alias'), 32);
  const explicitPlatform = clean(modalValue(fields, 'platform'), 16);
  const explicitMr = clean(modalValue(fields, 'mr'), 4);
  const combined = splitPlatformMr(modalValue(fields, 'platform_mr'));
  const platform = explicitPlatform || combined.platform;
  const mr = explicitMr || combined.mr;
  const availability = clean(modalValue(fields, 'availability'), 100);
  const prior = clean(modalValue(fields, 'prior') || modalValue(fields, 'prior_clan'), 40);
  const why = clean(modalValue(fields, 'why'), 400);
  const errors = [];
  if (!alias) errors.push('alias');
  if (!platform) errors.push('platform');
  if (!/^\d{1,2}$/.test(mr) || Number(mr) > 40) errors.push('mr');
  if (!availability) errors.push('availability');
  if (!why) errors.push('why');
  return {
    ok: errors.length === 0,
    errors,
    application: { alias, platform, mr, availability, prior, why }
  };
}

function clanFieldPrompt(errors) {
  const labels = {
    alias: 'an alias',
    platform: 'a platform',
    mr: 'a mastery rank from 0 to 40',
    availability: 'availability',
    why: 'why you want to join'
  };
  const missing = errors.map((key) => labels[key] || key).filter(Boolean);
  return `Add ${missing.join(', ')}. Platform and MR go in one box, for example PC 18.`;
}

function textRow(customId, label, style, { required = true, maxLength = 80, placeholder = '' } = {}) {
  const input = new TextInputBuilder().setCustomId(customId).setLabel(label).setStyle(style).setRequired(required).setMaxLength(maxLength);
  if (placeholder) input.setPlaceholder(placeholder);
  return new ActionRowBuilder().addComponents(input);
}

function clanApplicationModal() {
  return new ModalBuilder()
    .setCustomId('cephalon:clan:submit')
    .setTitle('Warframe clan application')
    .addComponents(
      textRow('alias', 'In-game alias', TextInputStyle.Short, { maxLength: 32, placeholder: 'Your Warframe name' }),
      textRow('platform_mr', 'Platform and MR', TextInputStyle.Short, { maxLength: 24, placeholder: 'PC 18' }),
      textRow('availability', 'Availability', TextInputStyle.Short, { maxLength: 100, placeholder: 'Evenings, weekends' }),
      textRow('prior', 'Prior clan', TextInputStyle.Short, { required: false, maxLength: 40, placeholder: 'None' }),
      textRow('why', 'Why join', TextInputStyle.Paragraph, { maxLength: 400 })
    );
}

function isClanOfficer(interaction, officerRoleId) {
  const roleId = snowflake(officerRoleId);
  if (!roleId) return false;
  const cache = interaction?.member?.roles?.cache;
  if (!cache) return false;
  if (typeof cache.has === 'function' && cache.has(roleId)) return true;
  if (typeof cache.some === 'function') return cache.some((role) => String(role?.id || role) === roleId);
  if (Array.isArray(cache)) return cache.map((role) => String(role?.id || role)).includes(roleId);
  return false;
}

function clanApplicationEmbed(userId, application, status = 'pending') {
  const titles = {
    pending: 'Warframe clan application',
    approved: 'Warframe clan application — Approved',
    rejected: 'Warframe clan application — Rejected'
  };
  const colors = { pending: 0x5865F2, approved: 0x57F287, rejected: 0xED4245 };
  return {
    title: titles[status] || titles.pending,
    description: `<@${userId}>`,
    color: colors[status] || colors.pending,
    fields: [
      { name: 'Alias', value: application.alias || '—', inline: true },
      { name: 'Platform', value: application.platform || '—', inline: true },
      { name: 'MR', value: application.mr || '—', inline: true },
      { name: 'Availability', value: application.availability || '—', inline: false },
      { name: 'Prior clan', value: application.prior || 'None listed', inline: false },
      { name: 'Why join', value: application.why || '—', inline: false }
    ],
    footer: { text: `cephalon:clan:${status}:${userId}` }
  };
}

function decisionComponents(applicantId, disabled = false) {
  return [{
    type: 1,
    components: [
      { type: 2, style: 3, label: 'Approve', custom_id: `cephalon:clan:approve:${applicantId}`, disabled: Boolean(disabled) },
      { type: 2, style: 4, label: 'Reject', custom_id: `cephalon:clan:reject:${applicantId}`, disabled: Boolean(disabled) }
    ]
  }];
}

function clanPanelPayload() {
  return {
    embeds: [{
      title: 'Warframe clan applications',
      description: 'Press **Apply** to open the form. Officers use Approve or Reject on each application. Approve adds the Warframe Clan Member role.',
      footer: { text: 'Cephalon Nexus • clan applications' }
    }],
    components: [{
      type: 1,
      components: [{ type: 2, style: 1, label: 'Apply', custom_id: 'cephalon:clan:apply' }]
    }]
  };
}

function applicationStatus(message) {
  const embed = message?.embeds?.[0];
  const footer = String(embed?.footer?.text || embed?.data?.footer?.text || '');
  const match = /^cephalon:clan:(pending|approved|rejected):(\d{17,20})$/.exec(footer);
  return match ? { status: match[1], userId: match[2] } : { status: '', userId: '' };
}

function decidedEmbed(message, status, userId) {
  const embed = message?.embeds?.[0]?.toJSON?.() || message?.embeds?.[0]?.data || message?.embeds?.[0] || {};
  const titles = {
    approved: 'Warframe clan application — Approved',
    rejected: 'Warframe clan application — Rejected'
  };
  const colors = { approved: 0x57F287, rejected: 0xED4245 };
  const fields = (Array.isArray(embed.fields) ? embed.fields : []).map((field) => ({
    name: String(field.name || 'Field').slice(0, 256),
    value: String(field.value || '—').slice(0, 1024),
    inline: Boolean(field.inline)
  }));
  return {
    title: titles[status] || titles.approved,
    description: embed.description || `<@${userId}>`,
    color: colors[status] || colors.approved,
    fields,
    footer: { text: `cephalon:clan:${status}:${userId}` }
  };
}

function clanPanelFile(context, env) {
  return path.join(context.dir || runtimeDataDir(env), 'cephalon-clan-panel.json');
}

async function refreshClanPanel(context, env = context.env || process.env) {
  const { channelId } = clanConfig(env);
  if (!channelId) return { pinned: false, reason: 'unset' };
  const file = clanPanelFile(context, env);
  const saved = readJson(file, { messageId: '' });
  const result = await upsertEmbed(context.client, channelId, saved.messageId, clanPanelPayload(), {
    panel: 'clanApplications',
    botId: context.client?.user?.id
  });
  if (result.messageId && result.reason !== 'foreign-unmatched') writeJson(file, { messageId: result.messageId });
  if (result.created || result.migrated || result.duplicatesRemoved || result.foreignRemoved) {
    console.log(`[Cephalon Nexus] clan panel message=${result.messageId} created=${result.created ? 'yes' : 'no'} migrated=${result.migrated ? 'yes' : 'no'} duplicatesRemoved=${result.duplicatesRemoved || 0} foreignRemoved=${result.foreignRemoved || 0}`);
  }
  return result;
}

async function handleClanPanelCommand(interaction, context) {
  const config = context.config || {};
  if (!isStaff(interaction, config)) {
    await interaction.reply(ephemeralText('Only Nexus staff can refresh the clan application panel.'));
    return true;
  }
  const sub = interaction.options?.getSubcommand?.() || 'panel';
  if (sub !== 'panel') {
    await interaction.reply(ephemeralText('That clan command is not available.'));
    return true;
  }
  const env = context.env || process.env;
  const client = context.client || interaction.client;
  const result = await refreshClanPanel({ ...context, client }, env).catch((error) => {
    console.warn(`[Cephalon Nexus] clan panel class=${errorClass(error)}`);
    return { pinned: false, reason: 'error' };
  });
  if (!result?.messageId) {
    await interaction.reply(ephemeralText('The clan application panel could not be posted. Check the applications channel and Cephalon Nexus permissions.'));
    return true;
  }
  await interaction.reply(ephemeralText(result.created ? 'Posted the clan application panel.' : 'Updated the clan application panel.'));
  return true;
}

async function handleClanButton(interaction, context) {
  const parsed = parseClanCustomId(interaction.customId);
  if (!parsed) {
    await interaction.reply(ephemeralText('That clan control is not available.'));
    return true;
  }
  if (parsed.action === 'apply') {
    await interaction.showModal(clanApplicationModal());
    return true;
  }
  if (parsed.action === 'approve' || parsed.action === 'reject') return decideClanApplication(interaction, context, parsed);
  await interaction.reply(ephemeralText('That clan control is not available.'));
  return true;
}

function unknownMember(error) {
  const code = Number(error?.code || error?.rawError?.code || 0);
  return code === 10007 || /unknown member/i.test(String(error?.message || error || ''));
}

async function decideClanApplication(interaction, context, parsed) {
  const env = context.env || process.env;
  const { memberRoleId, officerRoleId } = clanConfig(env);
  if (!isClanOfficer(interaction, officerRoleId)) {
    await interaction.reply(ephemeralText('Only Warframe Clan Officers can approve or reject applications.'));
    return true;
  }
  const current = applicationStatus(interaction.message);
  if (current.status === 'approved' || current.status === 'rejected') {
    await interaction.reply(ephemeralText('This application is already decided.'));
    return true;
  }
  if (current.userId && current.userId !== parsed.userId) {
    await interaction.reply(ephemeralText('That decision does not match this application.'));
    return true;
  }
  if (parsed.action === 'approve') {
    if (!memberRoleId) {
      await interaction.reply(ephemeralText('The Warframe Clan Member role is not configured.'));
      return true;
    }
    try {
      const guild = interaction.guild;
      if (!guild || typeof guild.members?.fetch !== 'function') throw new Error('guild-missing');
      const member = await guild.members.fetch(parsed.userId);
      await member.roles.add(memberRoleId);
    } catch (error) {
      if (unknownMember(error)) {
        await interaction.reply(ephemeralText('That applicant is not in the server, so the role was not added.'));
        return true;
      }
      console.warn(`[Cephalon Nexus] clan approve class=${errorClass(error)}`);
      await interaction.reply(ephemeralText('I could not add the Warframe Clan Member role. Move Cephalon Nexus above that role and allow Manage Roles.'));
      return true;
    }
  }
  const status = parsed.action === 'approve' ? 'approved' : 'rejected';
  const payload = {
    embeds: [decidedEmbed(interaction.message, status, parsed.userId)],
    components: decisionComponents(parsed.userId, true),
    allowedMentions: { parse: [] }
  };
  const note = status === 'approved'
    ? 'Approved. Warframe Clan Member role added.'
    : 'Rejected. No role was added.';
  if (typeof interaction.update === 'function') {
    await interaction.update(payload);
    if (typeof interaction.followUp === 'function') await interaction.followUp(ephemeralText(note));
  } else {
    await interaction.reply({ ...payload, ...ephemeralText(note) });
  }
  return true;
}

async function handleClanModal(interaction, context) {
  const parsed = parseClanCustomId(interaction.customId);
  if (!parsed || parsed.action !== 'submit') {
    await interaction.reply(ephemeralText('That clan form is not available.'));
    return true;
  }
  const form = parseClanApplication(interaction.fields || {});
  if (!form.ok) {
    await interaction.reply(ephemeralText(clanFieldPrompt(form.errors)));
    return true;
  }
  const env = context.env || process.env;
  const { channelId, officerRoleId } = clanConfig(env);
  const userId = snowflake(interaction.user?.id);
  if (!userId || !channelId) {
    await interaction.reply(ephemeralText('The clan application channel is not available.'));
    return true;
  }
  const client = context.client || interaction.client;
  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || typeof channel.send !== 'function') throw new Error('channel-missing');
    const sent = await channel.send({
      content: officerRoleId ? `<@&${officerRoleId}>` : '',
      embeds: [clanApplicationEmbed(userId, form.application, 'pending')],
      components: decisionComponents(userId, false),
      allowedMentions: { parse: [], roles: officerRoleId ? [officerRoleId] : [] }
    });
    console.log(`[Cephalon Nexus] clan application user=${userId} message=${sent?.id || ''}`);
  } catch (error) {
    console.warn(`[Cephalon Nexus] clan application class=${errorClass(error)}`);
    await interaction.reply(ephemeralText('The application could not be posted. Try again in a minute.'));
    return true;
  }
  await interaction.reply(ephemeralText('Application posted for the officers.'));
  return true;
}

function profileQuery(value) {
  const name = clean(value, 24);
  return /^[A-Za-z0-9][A-Za-z0-9_.-]{0,23}$/.test(name) ? name : '';
}

function unwrapProfile(data) {
  if (data && typeof data === 'object' && data.data && typeof data.data === 'object' && !data.displayName && !data.username && data.masteryRank == null) {
    return data.data;
  }
  return data;
}

function profileCard(data, queried = '') {
  const body = unwrapProfile(data);
  if (!body || typeof body !== 'object' || body.error) return null;
  const displayName = clean(body.displayName || body.username || '', 32);
  const masteryRank = Number(body.masteryRank);
  const mastery = Number.isFinite(masteryRank) ? String(masteryRank) : '';
  const guildName = clean(body.guildName || body.clan || '', 80);
  const guildId = clean(body.guildId || '', 64);
  if (!displayName && !mastery && !guildName && !guildId) return null;
  return { displayName: displayName || clean(queried, 32), mastery, guildName, guildId };
}

function profileEmbed(card) {
  const fields = [{ name: 'Mastery', value: card.mastery ? `MR ${card.mastery}` : 'Not listed', inline: true }];
  if (card.guildName) fields.push({ name: 'Clan', value: card.guildName, inline: true });
  if (card.guildId) fields.push({ name: 'Clan id', value: card.guildId, inline: true });
  if (!card.guildName && !card.guildId) fields.push({ name: 'Clan', value: 'Not listed', inline: true });
  return {
    title: card.displayName || 'Warframe profile',
    description: 'Public Warframe profile. No Digital Extremes login.',
    fields,
    footer: { text: WFCD_FOOTER }
  };
}

function profileFailure(error) {
  const text = String(error?.message || error || '');
  if (/\bHTTP 404\b/.test(text) || /no such profile/i.test(text) || /not found/i.test(text)) return 'missing';
  return 'down';
}

async function fetchProfile(context, username) {
  const provider = providerFor(context);
  if (typeof provider.profile === 'function') return provider.profile(username);
  const base = String(provider.worldstateBase || 'https://api.warframestat.us').replace(/\/$/, '');
  if (typeof provider.requestJson !== 'function') throw new Error('Profile lookup is not available.');
  return provider.requestJson(`${base}/profile/${encodeURIComponent(username)}`);
}

async function handleProfileCommand(interaction, context) {
  const username = profileQuery(interaction.options?.getString?.('username'));
  if (!username) {
    await interaction.reply(ephemeralText('Use the in-game name: letters, numbers, and . _ -.'));
    return true;
  }
  try {
    const card = profileCard(await fetchProfile(context, username), username);
    if (!card) {
      await interaction.reply(ephemeralText(`No public profile for **${username}**. Check the spelling. This lookup does not use a Digital Extremes login.`));
      return true;
    }
    await interaction.reply(ephemeralEmbed(profileEmbed(card)));
  } catch (error) {
    if (profileFailure(error) === 'missing') {
      await interaction.reply(ephemeralText(`No public profile for **${username}**. Check the spelling. This lookup does not use a Digital Extremes login.`));
      return true;
    }
    console.warn(`[Cephalon Nexus] profile class=${errorClass(error)}`);
    await interaction.reply(ephemeralText('Profile lookup is unavailable right now. Try again in a minute.'));
  }
  return true;
}

function normalizeDuviri(data) {
  if (!data || typeof data !== 'object') return null;
  const choices = (Array.isArray(data.choices) ? data.choices : []).slice(0, 4).map((group) => ({
    category: clean(group?.category || group?.categoryKey || 'Choices', 24) || 'Choices',
    choices: (Array.isArray(group?.choices) ? group.choices : []).slice(0, 8).map((item) => clean(typeof item === 'string' ? item : item?.name || item?.item || '', 40)).filter(Boolean)
  })).filter((group) => group.choices.length);
  return {
    state: clean(data.state || 'unknown', 40) || 'unknown',
    timeLeft: clean(data.timeLeft || data.eta || '', 40),
    choices
  };
}

function normalizeSteelReward(data) {
  if (!data || typeof data !== 'object') return null;
  const reward = data.currentReward;
  const name = clean(reward?.name || (typeof reward === 'string' ? reward : ''), 80);
  return { reward: name, remaining: clean(data.remaining || data.eta || '', 40) };
}

function normalizeArchimedea(data) {
  const rows = Array.isArray(data) ? data : (data ? [data] : []);
  return rows.slice(0, 2).map((row) => ({
    eta: clean(row?.eta || row?.timeLeft || '', 40),
    missions: (Array.isArray(row?.missions) ? row.missions : []).slice(0, 3).map((mission) => ({
      type: clean(mission?.missionType || mission?.type || mission?.mission || 'Mission', 40) || 'Mission',
      faction: clean(mission?.faction || '', 40),
      deviation: clean(mission?.deviation?.name || (typeof mission?.deviation === 'string' ? mission.deviation : ''), 60),
      risks: (Array.isArray(mission?.risks) ? mission.risks : []).slice(0, 4).map((risk) => clean(risk?.name || risk, 40)).filter(Boolean)
    }))
  })).filter((row) => row.missions.length || row.eta);
}

function circuitLines(partial = {}) {
  const missing = new Set(partial.missing || []);
  const lines = ['**Circuit**', 'Public world-state digest. No Digital Extremes login.', ''];
  const duviri = missing.has('duviri') ? null : normalizeDuviri(partial.duviri);
  if (!duviri) lines.push('**Duviri:** unavailable');
  else {
    lines.push(`**Duviri:** ${duviri.state}${duviri.timeLeft ? ` · ${duviri.timeLeft}` : ''}`);
    for (const group of duviri.choices) lines.push(`${group.category}: ${group.choices.join(', ')}`);
  }
  const steel = missing.has('steelPath') ? null : normalizeSteelReward(partial.steelPath);
  if (!steel) lines.push('**Steel Path:** unavailable');
  else if (!steel.reward) lines.push(`**Steel Path:** no reward listed${steel.remaining ? ` · ${steel.remaining}` : ''}`);
  else lines.push(`**Steel Path:** ${steel.reward}${steel.remaining ? ` · ${steel.remaining}` : ''}`);
  const archimedea = missing.has('archimedea') ? [] : normalizeArchimedea(partial.archimedea);
  if (!archimedea.length) lines.push('**Archimedea:** unavailable');
  else {
    lines.push('**Archimedea:**');
    for (const row of archimedea) {
      if (row.eta) lines.push(`Resets ${row.eta}`);
      for (const mission of row.missions) {
        const bits = [mission.type, mission.faction, mission.deviation ? `deviation ${mission.deviation}` : ''].filter(Boolean);
        lines.push(bits.join(' · '));
        if (mission.risks.length) lines.push(`Risks: ${mission.risks.join(', ')}`);
      }
    }
  }
  return lines;
}

function circuitEmbed(partial) {
  return {
    title: 'Circuit digest',
    description: circuitLines(partial).join('\n').slice(0, 4000),
    footer: { text: WFCD_FOOTER }
  };
}

function circuitCacheFor(context, env) {
  if (context.circuitCache) return context.circuitCache;
  context.circuitCache = new TtlCache({
    ttlMs: cacheTtl(env.CEPHALON_CIRCUIT_CACHE_MS),
    load: async () => {
      const provider = providerFor(context);
      const partial = { missing: [] };
      const paths = [['duviri', 'duviriCycle'], ['steelPath', 'steelPath'], ['archimedea', 'deepArchimedea']];
      for (const [key, pathname] of paths) {
        try {
          partial[key] = await provider.worldstate(pathname);
        } catch {
          partial.missing.push(key);
        }
      }
      return partial;
    }
  });
  return context.circuitCache;
}

async function handleCircuitCommand(interaction, context) {
  const env = context.env || process.env;
  try {
    const loaded = await circuitCacheFor(context, env).get();
    await interaction.reply(ephemeralEmbed(circuitEmbed(loaded.value)));
  } catch (error) {
    console.warn(`[Cephalon Nexus] circuit class=${errorClass(error)}`);
    await interaction.reply(ephemeralText('Circuit data is unavailable right now. Try again in a minute.'));
  }
  return true;
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
  handleCephalonModal,
  handleClanPanelCommand,
  handleClanButton,
  handleClanModal,
  handleProfileCommand,
  handleCircuitCommand,
  CycleWatch,
  startCephalonBoards,
  challengeKey,
  CLAN_DEFAULTS,
  clanConfig,
  parseClanCustomId,
  parseClanApplication,
  clanApplicationModal,
  isClanOfficer,
  clanApplicationEmbed,
  decisionComponents,
  refreshClanPanel,
  profileQuery,
  profileCard,
  profileEmbed,
  normalizeDuviri,
  normalizeSteelReward,
  normalizeArchimedea,
  circuitLines,
  circuitEmbed
};

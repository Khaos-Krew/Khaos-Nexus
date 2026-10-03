'use strict';

const { errorClass } = require('../../command-failure.cjs');
const { bungieConfig, statePaths } = require('../config.cjs');
const { createAlerter } = require('./alerts.cjs');
const { createCache } = require('./cache.cjs');
const { createBungieClient } = require('./client.cjs');
const { countOnlineMembers, fetchClanRoster, fetchClanSummary, normalizeAdmins, normalizeRoster, normalizeSummary } = require('./clan.cjs');
const { createHealth } = require('./health.cjs');
const { createManifest } = require('./manifest.cjs');
const { createManifestQuery } = require('./manifest-query.cjs');
const { lookupPlayer } = require('./player.cjs');
const { updateBungieStatus } = require('./status-snapshot.cjs');
const { formatCt } = require('./time.cjs');
const { publishPanel } = require('../panels/publish.cjs');
const { renderClanSummary } = require('../panels/clan.cjs');
const { milestoneRows, renderWeeklyReset } = require('../panels/weekly-reset.cjs');
const { locationFromVendors, renderXur, saleHashes } = require('../panels/xur.cjs');
const { lookupSaleItems } = require('../commands/d2-xur.cjs');
const { snowflake } = require('../config.cjs');

const HEALTH_MS = 5 * 60 * 1000;
const XUR_MS = 60 * 60 * 1000;
const SLOW_MS = 6 * 60 * 60 * 1000;
const PLAYER_MS = 10 * 1000;
const TICK_BUDGET_MS = 60 * 1000;

function reasonText(reason) {
  if (reason === 'disabled') return "That Destiny lookup isn't turned on yet. Ask staff.";
  if (reason === 'system-disabled') return 'Bungie is down for maintenance right now; try again later.';
  if (reason === 'unconfigured' || reason === 'gated') {
    return "Bungie isn't turned on yet. Ask staff.";
  }
  if (reason === 'auth' || reason === 'api-key') {
    return "Destiny lookups aren't working right now. Staff have been told; try again later.";
  }
  if (reason === 'private') {
    return "That player's Destiny profile is private, so we can't show it. They can make it public in their Bungie.net privacy settings.";
  }
  if (reason === 'not-found' || reason === 'no-account') return 'No Destiny account found.';
  if (reason === 'name') return 'Use a Bungie name like Name#1234.';
  if (reason === 'rate') return 'Slow down a moment and try again.';
  return 'Bungie data unavailable. Try again in a few minutes.';
}

function panelLanded(result) {
  if (!result) return false;
  if (Array.isArray(result)) return result.some(panelLanded);
  return result.reason !== 'unset' && result.reason !== 'missing';
}

function due(last, interval, at) {
  return !last || at - last >= interval;
}

function createBungieRuntime({
  env = process.env,
  discord,
  panelStore,
  channelsFor,
  now = Date.now,
  fetch,
  sleep,
  random,
  editLock = (task) => Promise.resolve().then(task)
} = {}) {
  const paths = statePaths(env);
  const cache = createCache({ now });
  const query = createManifestQuery();
  const health = createHealth({ file: paths.health, now: () => new Date(now()) });
  const manifest = createManifest({ dir: paths.manifestDir, now: () => new Date(now()) });
  const playerHits = new Map();
  const warming = new Set();
  const timers = { health: 0, manifest: 0, reset: 0, xur: 0, clan: 0 };
  let resetAt = 0;

  async function sendAlert(text) {
    const channelId = snowflake(env.VANGUARD_STAFF_ALERT_CHANNEL_ID) || snowflake(env.NEXUS_STAFF_ALERT_CHANNEL_ID);
    console.warn(`[Nexus Vanguard] staff alert: ${text}`);
    if (!channelId || typeof discord?.channels?.fetch !== 'function') return;
    const channel = await discord.channels.fetch(channelId).catch(() => null);
    if (typeof channel?.send !== 'function') return;
    await channel.send({ content: String(text).slice(0, 1800), allowedMentions: { parse: [] } });
  }

  const alerter = createAlerter({ now, send: sendAlert });
  const api = createBungieClient({
    env,
    now,
    fetch,
    sleep,
    random,
    alert: (kind, text) => alerter.alert(kind, text)
  });
  const config = () => bungieConfig(env);

  function syncStatus() {
    const current = manifest.current();
    const snapshot = health.read();
    updateBungieStatus({
      configured: config().configured,
      ...api.limiter.stats(),
      manifestVersion: current?.version || '',
      degraded: Boolean(snapshot?.degraded),
      reason: snapshot?.reason || ''
    });
  }

  function flagOpen(name) {
    const settings = config();
    if (name === 'reset') return settings.resetPanel;
    if (name === 'xur') return settings.xurPanel;
    if (name === 'lookup') return settings.playerLookup;
    if (name === 'clan-panel') return settings.clanPanel && settings.clanGroupIds.length > 0;
    if (name === 'clan') return settings.clanGroupIds.length > 0;
    return false;
  }

  function feature(name) {
    const settings = config();
    if (!settings.configured) return { ok: false, reason: 'unconfigured' };
    const flagName = name === 'clan-panel' ? 'clan-panel' : name;
    if (!flagOpen(flagName)) return { ok: false, reason: 'disabled' };
    if (api.stopped) return { ok: false, reason: 'auth' };
    const gate = name === 'clan-panel' ? 'clan' : name;
    if (!health.allows(gate)) return { ok: false, reason: snapshotReason() };
    return { ok: true };
  }

  function snapshotReason() {
    const snapshot = health.read();
    if (!snapshot) return 'gated';
    if (snapshot.degraded) {
      if (snapshot.reason === 'api-key') return 'auth';
      if (snapshot.reason === 'system-disabled') return 'system-disabled';
      return 'unavailable';
    }
    return 'system-disabled';
  }

  async function refreshHealth() {
    timers.health = now();
    if (!config().configured) return null;
    const snapshot = await health.poll(api);
    syncStatus();
    return snapshot;
  }

  async function refreshManifest() {
    timers.manifest = now();
    if (!health.allows('manifest')) return { ok: false, reason: 'gated' };
    const loaded = await manifest.ensure(api);
    if (loaded.ok && loaded.path) query.open(loaded.path);
    syncStatus();
    return loaded;
  }

  function namesFor(table, hashes) {
    const names = new Map();
    for (const hash of hashes) {
      const name = query.nameFor(table, hash);
      if (name) names.set(String(hash), name);
    }
    return names;
  }

  async function weeklyView() {
    let payload = cache.get('milestones');
    if (!payload) {
      const result = await api.get('/Destiny2/Milestones/');
      if (!result.ok) return { ok: false, reason: result.reason || result.kind || 'unavailable' };
      payload = result.json;
      cache.set('milestones', payload);
    }
    const rows = milestoneRows(payload);
    const embed = renderWeeklyReset({
      milestones: payload,
      names: namesFor('DestinyMilestoneDefinition', rows.map((row) => row.milestoneHash)),
      now: now()
    });
    resetAt = embed.resetAt || 0;
    return { ok: true, embed };
  }

  async function xurView() {
    let payload = cache.get('vendors');
    if (!payload) {
      const result = await api.get('/Destiny2/Vendors/', { components: '400,402' });
      if (!result.ok) return { ok: false, reason: result.reason || result.kind || 'unavailable' };
      payload = result.json;
      cache.set('vendors', payload);
    }
    const names = lookupSaleItems(query, saleHashes(payload));
    return { ok: true, embed: renderXur({ vendors: payload, names, now: now(), location: locationFromVendors(payload) }) };
  }

  async function clanSummary(groupId) {
    const key = `clan:${groupId}`;
    let payload = cache.get(key);
    if (!payload) {
      const fetched = await fetchClanSummary(api, groupId);
      if (!fetched.summary.ok) return { ok: false, reason: fetched.summary.reason || fetched.summary.kind || 'unavailable' };
      const summary = normalizeSummary(fetched.summary.json);
      let online = null;
      try {
        online = await countOnlineMembers(api, groupId);
      } catch (error) {
        online = null;
        console.warn(`[Nexus Vanguard] clan online class=${errorClass(error)}`);
      }
      payload = {
        summary,
        admins: fetched.admins.ok ? normalizeAdmins(fetched.admins.json) : [],
        online
      };
      cache.set(key, payload);
    }
    return { ok: true, ...payload, embed: renderClanSummary({ summary: payload.summary, online: payload.online }) };
  }

  function warmClan(groupId) {
    const id = String(groupId || '');
    if (!id || cache.get(`clan:${id}`)) return;
    if (!feature('clan').ok) return;
    if (warming.has(id)) return;
    warming.add(id);
    void clanSummary(id).catch((error) => {
      console.warn(`[Nexus Vanguard] clan warm class=${errorClass(error)}`);
    }).finally(() => warming.delete(id));
  }

  async function clanRoster(groupId, page) {
    const current = Math.max(1, Number(page) || 1);
    const key = `roster:${groupId}:${current}`;
    let roster = cache.get(key);
    if (!roster) {
      const fetched = await fetchClanRoster(api, groupId, current);
      if (!fetched.result.ok) return { ok: false, reason: fetched.result.reason || fetched.result.kind || 'unavailable' };
      roster = normalizeRoster(fetched.result.json, current);
      cache.set(key, roster, 5 * 60 * 1000);
    }
    const summary = await clanSummary(groupId);
    return { ok: true, roster, summary: summary.ok ? summary.summary : { name: 'Clan' } };
  }

  async function player(rawName, userId) {
    const at = now();
    const previous = playerHits.get(String(userId || '')) || 0;
    if (userId && previous && at - previous < PLAYER_MS) return { ok: false, reason: 'rate' };
    if (userId) playerHits.set(String(userId), at);
    return lookupPlayer({ client: api, manifest: query, cache, rawName });
  }

  async function publishClosed(guildId, panelId, title, gate, force) {
    if (gate.reason === 'disabled' || gate.reason === 'unconfigured') return gate;
    if (gate.reason === 'system-disabled') {
      return publishOne(guildId, panelId, {
        title,
        description: 'Bungie is down for maintenance right now; try again later.'
      }, { force });
    }
    if (gate.reason === 'gated') {
      return publishOne(guildId, panelId, {
        title,
        description: `Bungie system disabled (as of ${formatCt(health.read()?.checkedAt || now())}).`
      }, { force });
    }
    return publishOne(guildId, panelId, { title, description: '' }, { degraded: true, force });
  }

  async function publishOne(guildId, panelId, embed, { degraded = false, force = false } = {}) {
    const channelId = channelsFor(guildId).panels;
    return editLock(() => publishPanel({ client: discord, panelStore, env }, {
      guildId,
      panelId,
      channelId,
      embed,
      degraded,
      asOf: health.read()?.checkedAt || now(),
      force
    }));
  }

  async function withBudget(task) {
    const opened = typeof api.beginBudget === 'function' && api.beginBudget(now() + TICK_BUDGET_MS);
    try {
      return await task();
    } finally {
      if (opened) api.endBudget();
    }
  }

  async function refreshPanels(guildId, { which = 'all', force = false } = {}) {
    return withBudget(() => refreshPanelsWithin(guildId, { which, force }));
  }

  async function refreshPanelsWithin(guildId, { which = 'all', force = false } = {}) {
    const wanted = which === 'all' ? ['reset', 'xur', 'clan'] : [which];
    const results = {};
    for (const name of wanted) {
      if (name === 'reset') {
        const gate = feature('reset');
        if (!gate.ok) {
          results.reset = await publishClosed(guildId, 'weekly-reset', '🗓️ Weekly Reset', gate, force);
          continue;
        }
        if (force) cache.delete('milestones');
        const view = await weeklyView();
        results.reset = view.ok
          ? await publishOne(guildId, 'weekly-reset', view.embed, { force })
          : await publishOne(guildId, 'weekly-reset', { title: '🗓️ Weekly Reset', description: '' }, { degraded: true, force });
      } else if (name === 'xur') {
        const gate = feature('xur');
        if (!gate.ok) {
          results.xur = await publishClosed(guildId, 'xur', '✨ Xûr', gate, force);
          continue;
        }
        if (force) cache.delete('vendors');
        const view = await xurView();
        results.xur = view.ok
          ? await publishOne(guildId, 'xur', view.embed, { force })
          : await publishOne(guildId, 'xur', { title: '✨ Xûr', description: '' }, { degraded: true, force });
      } else if (name === 'clan') {
        const gate = feature('clan-panel');
        if (!gate.ok) {
          if (gate.reason === 'disabled' || gate.reason === 'unconfigured') {
            results.clan = gate;
            continue;
          }
          results.clan = [];
          for (const groupId of config().clanGroupIds) {
            results.clan.push(await publishClosed(guildId, `clan:${groupId}`, '👥 Clan', gate, force));
          }
          continue;
        }
        results.clan = [];
        for (const groupId of config().clanGroupIds) {
          if (force) cache.delete(`clan:${groupId}`);
          const view = await clanSummary(groupId);
          const published = view.ok
            ? await publishOne(guildId, `clan:${groupId}`, view.embed, { force })
            : await publishOne(guildId, `clan:${groupId}`, { title: '👥 Clan', description: 'Khaos Nexus clan' }, { degraded: true, force });
          results.clan.push(published);
        }
      }
    }
    return results;
  }

  async function boot(guildId) {
    return withBudget(() => bootWithin(guildId));
  }

  async function bootWithin(guildId) {
    if (!config().configured) {
      syncStatus();
      return { ok: false, reason: 'unconfigured' };
    }
    await refreshHealth();
    let manifestResult = null;
    if (health.allows('manifest')) manifestResult = await refreshManifest();
    const panels = guildId ? await refreshPanelsWithin(guildId, { which: 'all', force: true }) : {};
    const at = now();
    timers.health = at;
    timers.manifest = at;
    if (panelLanded(panels.reset)) timers.reset = at;
    if (panelLanded(panels.xur)) timers.xur = at;
    if (panelLanded(panels.clan)) timers.clan = at;
    return { ok: true, manifest: manifestResult, panels };
  }

  async function tick(guildId) {
    return withBudget(() => tickWithin(guildId));
  }

  async function tickWithin(guildId) {
    if (!config().configured || !guildId) return;
    const at = now();
    if (at - timers.health >= HEALTH_MS) await refreshHealth();
    const versionBefore = manifest.current()?.version || '';
    if (health.allows('manifest') && at - timers.manifest >= config().manifestPollMin * 60 * 1000) {
      await refreshManifest();
    }
    const versionAfter = manifest.current()?.version || '';
    if (versionBefore && versionAfter && versionBefore !== versionAfter) {
      cache.delete('milestones');
      cache.delete('vendors');
      const refreshed = await refreshPanelsWithin(guildId, { which: 'all', force: true });
      if (panelLanded(refreshed.reset)) timers.reset = at;
      if (panelLanded(refreshed.xur)) timers.xur = at;
      if (panelLanded(refreshed.clan)) timers.clan = at;
      return;
    }
    if (health.read()?.degraded) {
      await refreshPanelsWithin(guildId, { which: 'all', force: false });
      return;
    }
    if (config().resetPanel && (due(timers.reset, SLOW_MS, at) || (resetAt && at >= resetAt))) {
      if (resetAt && at >= resetAt) cache.delete('milestones');
      const refreshed = await refreshPanelsWithin(guildId, { which: 'reset', force: true });
      if (panelLanded(refreshed.reset)) timers.reset = at;
    }
    if (config().xurPanel && due(timers.xur, XUR_MS, at)) {
      const refreshed = await refreshPanelsWithin(guildId, { which: 'xur', force: true });
      if (panelLanded(refreshed.xur)) timers.xur = at;
    }
    if (config().clanPanel && due(timers.clan, SLOW_MS, at)) {
      const refreshed = await refreshPanelsWithin(guildId, { which: 'clan', force: true });
      if (panelLanded(refreshed.clan)) timers.clan = at;
    }
  }

  syncStatus();
  return {
    api,
    query,
    cache,
    health,
    manifest,
    feature,
    reasonText,
    weeklyView,
    xurView,
    clanSummary,
    warmClan,
    clanRoster,
    player,
    refreshPanels,
    boot,
    tick,
    syncStatus
  };
}

module.exports = {
  HEALTH_MS,
  XUR_MS,
  SLOW_MS,
  PLAYER_MS,
  TICK_BUDGET_MS,
  reasonText,
  createBungieRuntime
};

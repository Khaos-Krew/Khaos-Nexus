'use strict';

const { bungieConfig, statePaths } = require('../config.cjs');
const { createAlerter } = require('./alerts.cjs');
const { createCache } = require('./cache.cjs');
const { createBungieClient } = require('./client.cjs');
const { fetchClanRoster, fetchClanSummary, normalizeAdmins, normalizeRoster, normalizeSummary } = require('./clan.cjs');
const { createHealth } = require('./health.cjs');
const { createManifest } = require('./manifest.cjs');
const { createManifestQuery } = require('./manifest-query.cjs');
const { lookupPlayer } = require('./player.cjs');
const { updateBungieStatus } = require('./status-snapshot.cjs');
const { formatCt } = require('./time.cjs');
const { publishPanel } = require('../panels/publish.cjs');
const { renderClanSummary } = require('../panels/clan.cjs');
const { milestoneRows, renderWeeklyReset } = require('../panels/weekly-reset.cjs');
const { renderXur, saleHashes } = require('../panels/xur.cjs');
const { snowflake } = require('../config.cjs');

const HEALTH_MS = 5 * 60 * 1000;
const XUR_MS = 60 * 60 * 1000;
const SLOW_MS = 6 * 60 * 60 * 1000;
const PLAYER_MS = 10 * 1000;

function reasonText(reason) {
  if (reason === 'unconfigured') return 'Bungie is not configured.';
  if (reason === 'disabled') return 'That Destiny lookup is not configured.';
  if (reason === 'auth' || reason === 'api-key') return 'API key invalid or misconfigured.';
  if (reason === 'gated' || reason === 'system-disabled') return 'Bungie system disabled.';
  if (reason === 'private') return 'Private';
  if (reason === 'not-found' || reason === 'no-account') return 'No Destiny account found.';
  if (reason === 'name') return 'Use a Bungie name like Name#1234.';
  if (reason === 'rate') return 'Slow down a moment and try again.';
  return 'Bungie data unavailable.';
}

function createBungieRuntime({
  env = process.env,
  discord,
  panelStore,
  channelsFor,
  now = Date.now,
  fetch,
  sleep,
  random
} = {}) {
  const paths = statePaths(env);
  const cache = createCache({ now });
  const query = createManifestQuery();
  const health = createHealth({ file: paths.health, now: () => new Date(now()) });
  const manifest = createManifest({ dir: paths.manifestDir, now: () => new Date(now()) });
  const playerHits = new Map();
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
    if (snapshot.degraded) return snapshot.reason === 'api-key' ? 'auth' : 'unavailable';
    return 'gated';
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
    const hashes = saleHashes(payload);
    const names = namesFor('DestinyInventoryItemDefinition', hashes);
    return { ok: true, embed: renderXur({ vendors: payload, names, now: now() }) };
  }

  async function clanSummary(groupId) {
    const key = `clan:${groupId}`;
    let payload = cache.get(key);
    if (!payload) {
      const fetched = await fetchClanSummary(api, groupId);
      if (!fetched.summary.ok) return { ok: false, reason: fetched.summary.reason || fetched.summary.kind || 'unavailable' };
      payload = {
        summary: normalizeSummary(fetched.summary.json),
        admins: fetched.admins.ok ? normalizeAdmins(fetched.admins.json) : []
      };
      cache.set(key, payload);
    }
    return { ok: true, ...payload, embed: renderClanSummary(payload) };
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
    return publishPanel({ client: discord, panelStore, env }, {
      guildId,
      panelId,
      channelId,
      embed,
      degraded,
      asOf: health.read()?.checkedAt || now(),
      force
    });
  }

  async function refreshPanels(guildId, { which = 'all', force = false } = {}) {
    const wanted = which === 'all' ? ['reset', 'xur', 'clan'] : [which];
    const results = {};
    for (const name of wanted) {
      if (name === 'reset') {
        const gate = feature('reset');
        if (!gate.ok) {
          results.reset = await publishClosed(guildId, 'weekly-reset', 'Vanguard • Weekly Reset', gate, force);
          continue;
        }
        if (force) cache.delete('milestones');
        const view = await weeklyView();
        results.reset = view.ok
          ? await publishOne(guildId, 'weekly-reset', view.embed, { force })
          : await publishOne(guildId, 'weekly-reset', { title: 'Vanguard • Weekly Reset', description: '' }, { degraded: true, force });
      } else if (name === 'xur') {
        const gate = feature('xur');
        if (!gate.ok) {
          results.xur = await publishClosed(guildId, 'xur', 'Vanguard • Xûr', gate, force);
          continue;
        }
        if (force) cache.delete('vendors');
        const view = await xurView();
        results.xur = view.ok
          ? await publishOne(guildId, 'xur', view.embed, { force })
          : await publishOne(guildId, 'xur', { title: 'Vanguard • Xûr', description: '' }, { degraded: true, force });
      } else if (name === 'clan') {
        const gate = feature('clan-panel');
        if (!gate.ok) {
          if (gate.reason === 'disabled' || gate.reason === 'unconfigured') {
            results.clan = gate;
            continue;
          }
          results.clan = [];
          for (const groupId of config().clanGroupIds) {
            results.clan.push(await publishClosed(guildId, `clan:${groupId}`, 'Vanguard • Clan', gate, force));
          }
          continue;
        }
        results.clan = [];
        for (const groupId of config().clanGroupIds) {
          if (force) cache.delete(`clan:${groupId}`);
          const view = await clanSummary(groupId);
          const published = view.ok
            ? await publishOne(guildId, `clan:${groupId}`, view.embed, { force })
            : await publishOne(guildId, `clan:${groupId}`, { title: 'Vanguard • Clan', description: '' }, { degraded: true, force });
          results.clan.push(published);
        }
      }
    }
    return results;
  }

  async function boot(guildId) {
    if (!config().configured) {
      syncStatus();
      return { ok: false, reason: 'unconfigured' };
    }
    await refreshHealth();
    let manifestResult = null;
    if (health.allows('manifest')) manifestResult = await refreshManifest();
    const panels = guildId ? await refreshPanels(guildId, { which: 'all', force: true }) : {};
    const at = now();
    timers.health = at;
    timers.manifest = at;
    timers.reset = at;
    timers.xur = at;
    timers.clan = at;
    return { ok: true, manifest: manifestResult, panels };
  }

  async function tick(guildId) {
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
      await refreshPanels(guildId, { which: 'all', force: true });
      timers.reset = at;
      timers.xur = at;
      timers.clan = at;
      return;
    }
    if (health.read()?.degraded) {
      await refreshPanels(guildId, { which: 'all', force: false });
      return;
    }
    if (config().resetPanel && (at - timers.reset >= SLOW_MS || (resetAt && at >= resetAt))) {
      timers.reset = at;
      if (resetAt && at >= resetAt) cache.delete('milestones');
      await refreshPanels(guildId, { which: 'reset', force: true });
    }
    if (config().xurPanel && at - timers.xur >= XUR_MS) {
      timers.xur = at;
      await refreshPanels(guildId, { which: 'xur', force: true });
    }
    if (config().clanPanel && at - timers.clan >= SLOW_MS) {
      timers.clan = at;
      await refreshPanels(guildId, { which: 'clan', force: true });
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
  reasonText,
  createBungieRuntime
};

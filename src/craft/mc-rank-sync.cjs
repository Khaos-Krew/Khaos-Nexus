'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { isRankSyncUuid, normalizeUuid } = require('./mc-rcon-text.cjs');
const { economyConfigured } = require('./mc-economy-http.cjs');

const GROUP_NAME = /^[a-z][a-z0-9_-]{2,47}$/;
const ROLE_ID = /^\d{17,20}$/;
const SERVER_NAME = /^[a-z0-9][a-z0-9_-]{0,31}$/;
const MAX_AUDIT_ENTRIES = 10_000;
const RANK_LOOP = Symbol.for('khaos.nexus.craft.mc.rankSync');

// Lowest to highest. Only the highest held group is granted. Lower groups are
// not added again, and the four ranks are never removed automatically.
const RANK_LADDER = Object.freeze(['shadecreeper', 'voidenderman', 'witherknight', 'nexusdragon']);
const SUB_LADDER = Object.freeze(['cipherrunner', 'nexusraider', 'khaoswarden']);
const PERMANENT_GROUPS = new Set([...RANK_LADDER, 'blackoutlegend', 'originfounder']);

// Shop subs and booster are removed when the role is gone. Legend and Founder
// stay (duplicate role ids are both mapped until the owner picks one). The four
// rank roles do not exist yet; add them with MC_RANK_ROLE_MAP_JSON.
const DEFAULT_ROLE_MAP = Object.freeze({
  '1539474083274563604': Object.freeze({ group: 'cipherrunner', kind: 'sub' }),
  '1539475000216789042': Object.freeze({ group: 'nexusraider', kind: 'sub' }),
  '1539475462512971837': Object.freeze({ group: 'khaoswarden', kind: 'sub' }),
  '1019830450006528011': Object.freeze({ group: 'booster', kind: 'sub' }),
  '1539453135981121626': Object.freeze({ group: 'blackoutlegend', kind: 'permanent' }),
  '1539526708825165914': Object.freeze({ group: 'blackoutlegend', kind: 'permanent' }),
  '1520530849475461280': Object.freeze({ group: 'originfounder', kind: 'permanent' }),
  '1539471959165771866': Object.freeze({ group: 'originfounder', kind: 'permanent' })
});

function clean(value, max = 160) {
  return String(value || '').replace(/[\r\n\t\u0000-\u001f]+/g, ' ').trim().slice(0, max);
}

function redactIds(value) {
  return clean(value, 160).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '[uuid]');
}

function validGroupName(value) {
  return GROUP_NAME.test(String(value || '').trim());
}

function envFlag(value, fallback) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return fallback;
  if (['1', 'true', 'yes', 'on'].includes(text)) return true;
  if (['0', 'false', 'no', 'off'].includes(text)) return false;
  return fallback;
}

function intervalMinutes(value) {
  const text = String(value ?? '').trim();
  if (!text) return 30;
  const parsed = Number(text);
  if (!Number.isFinite(parsed)) return 30;
  return Math.min(24 * 60, Math.max(1, Math.round(parsed)));
}

function mcRankSyncConfig(env = process.env) {
  return {
    enabled: envFlag(env.MC_RANK_SYNC_ENABLED, false),
    dryRun: envFlag(env.MC_RANK_SYNC_DRY_RUN, true),
    serverName: String(env.MC_RANK_SYNC_SERVER || '').trim().toLowerCase(),
    intervalMinutes: intervalMinutes(env.MC_RANK_SYNC_INTERVAL_MINUTES),
    provisionGroups: envFlag(env.MC_RANK_GROUP_PROVISION_ENABLED, false)
  };
}

function roleMapFromEnv(value = process.env.MC_RANK_ROLE_MAP_JSON) {
  const map = {};
  for (const [roleId, entry] of Object.entries(DEFAULT_ROLE_MAP)) map[roleId] = { group: entry.group, kind: entry.kind };
  const raw = String(value || '').trim();
  if (raw) {
    let parsed;
    try { parsed = JSON.parse(raw); } catch { throw new Error('MC_RANK_ROLE_MAP_JSON must be valid JSON.'); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('MC_RANK_ROLE_MAP_JSON must be an object.');
    for (const [roleId, entry] of Object.entries(parsed)) {
      if (!ROLE_ID.test(roleId)) throw new Error(`Invalid Discord role id ${roleId}.`);
      const group = String(entry?.group || '').trim().toLowerCase();
      const kind = String(entry?.kind || '').trim().toLowerCase();
      if (!validGroupName(group)) throw new Error(`Invalid LuckPerms group for role ${roleId}.`);
      if (kind !== 'sub' && kind !== 'permanent') throw new Error(`Invalid rank kind for role ${roleId}.`);
      if (PERMANENT_GROUPS.has(group) && kind !== 'permanent') throw new Error(`${group} is permanent and cannot be synced as a sub.`);
      map[roleId] = { group, kind };
    }
  }
  const kinds = new Map();
  for (const entry of Object.values(map)) {
    const prior = kinds.get(entry.group);
    if (prior && prior !== entry.kind) throw new Error(`LuckPerms group ${entry.group} has two kinds.`);
    kinds.set(entry.group, entry.kind);
  }
  return map;
}

function memberRoleIds(member) {
  const roles = member?.roles;
  if (!roles) return [];
  if (Array.isArray(roles)) return roles.map((id) => String(id));
  const cache = roles.cache;
  if (!cache) return [];
  if (typeof cache.keys === 'function') return [...cache.keys()].map((id) => String(id));
  if (Array.isArray(cache)) return cache.map((id) => String(id));
  return [];
}

function hasRoleCollection(member) {
  const roles = member?.roles;
  if (!roles) return false;
  if (Array.isArray(roles)) return true;
  return Boolean(roles.cache);
}

function rolesChanged(before, after) {
  if (!hasRoleCollection(before) || !hasRoleCollection(after)) return true;
  const left = memberRoleIds(before);
  const right = memberRoleIds(after);
  if (left.length !== right.length) return true;
  const held = new Set(right);
  return left.some((id) => !held.has(id));
}

function desiredGroups(member, roleMap = roleMapFromEnv('')) {
  const held = new Set(memberRoleIds(member));
  const subs = [];
  const permanents = [];
  for (const [roleId, entry] of Object.entries(roleMap || {})) {
    if (!held.has(roleId)) continue;
    if (entry.kind === 'permanent') permanents.push(entry.group);
    else subs.push(entry.group);
  }
  const desired = new Set();
  const ladderSubs = SUB_LADDER.filter((group) => subs.includes(group));
  if (ladderSubs.length) desired.add(ladderSubs[ladderSubs.length - 1]);
  for (const group of subs) if (!SUB_LADDER.includes(group)) desired.add(group);
  const ladderRanks = RANK_LADDER.filter((group) => permanents.includes(group));
  if (ladderRanks.length) desired.add(ladderRanks[ladderRanks.length - 1]);
  for (const group of permanents) if (!RANK_LADDER.includes(group)) desired.add(group);
  return desired;
}

function stripLpLine(line) {
  let text = String(line || '')
    .replace(/§[0-9a-fk-or]/gi, '')
    .replace(/&[0-9a-fk-or]/gi, '')
    .trim();
  for (let i = 0; i < 4; i += 1) {
    const next = text
      .replace(/^\[[^\]]*\]:?\s*/, '')
      .replace(/^(?:INFO|WARN|ERROR):\s*/i, '')
      .replace(/^\[(?:LP|LuckPerms)\]:?\s*/i, '')
      .trim();
    if (next === text) break;
    text = next;
  }
  return text;
}

function groupsFromLines(response) {
  const groups = new Set();
  for (const raw of String(response || '').split(/\r?\n/)) {
    const line = stripLpLine(raw);
    const match = line.match(/^(?:[-•>*]+\s+)([a-z][a-z0-9_-]{2,47})\b/i);
    if (!match) continue;
    const name = match[1].toLowerCase();
    if (validGroupName(name)) groups.add(name);
  }
  return groups;
}

function parseLpListGroups(response = '') {
  return groupsFromLines(response);
}

function parseLpParentInfo(response = '') {
  return groupsFromLines(response);
}

function uuidDigest(uuid) {
  return crypto.createHash('sha256').update(String(uuid || '')).digest('hex');
}

function warn(log, line) {
  if (typeof log?.warn === 'function') log.warn(line);
  else if (typeof log?.log === 'function') log.log(line);
}

function sleep(ms) {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    if (typeof timer.unref === 'function') timer.unref();
  });
}

class McRankSyncJournal {
  constructor(options = {}) {
    const root = options.root || process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..', 'data');
    this.file = path.join(path.resolve(root), 'mc-rank-sync-audit.json');
    this.now = typeof options.now === 'function' ? options.now : Date.now;
    this.maxEntries = Number.isInteger(options.maxEntries) ? options.maxEntries : MAX_AUDIT_ENTRIES;
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return { version: 1, entries: Array.isArray(parsed.entries) ? parsed.entries.slice(-this.maxEntries) : [] };
    } catch { return { version: 1, entries: [] }; }
  }

  record(entry = {}) {
    const state = this.read();
    const safe = { id: crypto.randomUUID(), at: new Date(this.now()).toISOString() };
    for (const [key, value] of Object.entries(entry)) {
      if (key === 'mcUuid' || key === 'uuid' || key === 'command' || key === 'commands') continue;
      safe[key] = value;
    }
    state.entries.push(safe);
    state.entries = state.entries.slice(-this.maxEntries);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    return state.entries.at(-1);
  }
}

class McLuckPermsRankSync {
  constructor({ rcon, roleMap, journal, provisionGroups = false, dryRun = true, minIntervalMs = 1000, now = Date.now, sleepImpl = sleep } = {}) {
    if (!rcon?.execute) throw new Error('McLuckPermsRankSync requires an RCON client.');
    this.rcon = rcon;
    this.roleMap = roleMap || roleMapFromEnv('');
    this.managedGroups = new Set(Object.values(this.roleMap).map((entry) => entry.group));
    this.managedSubs = new Set(Object.values(this.roleMap).filter((entry) => entry.kind === 'sub').map((entry) => entry.group));
    for (const group of PERMANENT_GROUPS) this.managedSubs.delete(group);
    this.journal = journal || new McRankSyncJournal();
    this.provisionGroups = Boolean(provisionGroups);
    this.dryRun = Boolean(dryRun);
    this.ready = false;
    this.writesEnabled = false;
    this.minIntervalMs = Math.max(0, Number(minIntervalMs) || 0);
    this.now = now;
    this.sleep = sleepImpl;
    this.lastAt = null;
    this.lanes = new Map();
    this.rconLane = Promise.resolve();
  }

  markReady(ok) {
    this.ready = Boolean(ok);
    this.writesEnabled = Boolean(ok) && !this.dryRun;
    return this.ready;
  }

  #lane(uuid, fn) {
    const prior = this.lanes.get(uuid) || Promise.resolve();
    const task = prior.catch(() => {}).then(fn);
    this.lanes.set(uuid, task);
    return task.finally(() => { if (this.lanes.get(uuid) === task) this.lanes.delete(uuid); });
  }

  #execute(command) {
    const run = async () => {
      if (this.lastAt != null && this.minIntervalMs > 0) {
        const wait = this.minIntervalMs - (this.now() - this.lastAt);
        if (wait > 0) await this.sleep(wait);
      }
      try {
        return await this.rcon.execute(command);
      } finally {
        this.lastAt = this.now();
      }
    };
    const task = this.rconLane.catch(() => {}).then(run);
    this.rconLane = task;
    return task;
  }

  async ensureGroups() {
    const existing = parseLpListGroups(await this.#execute('lp listgroups'));
    const missing = [...this.managedGroups].filter((group) => !existing.has(group)).sort();
    if (!missing.length) {
      this.journal.record({ action: 'rank-groups-checked', ok: true, created: [], missing: [] });
      return { ok: true, reason: '', created: [], missing };
    }
    if (!this.provisionGroups || this.dryRun) {
      this.journal.record({ action: 'rank-groups-checked', ok: false, dryRun: this.dryRun, created: [], missing });
      return { ok: false, reason: 'managed-groups-missing', created: [], missing };
    }
    const created = [];
    for (const group of missing) {
      await this.#execute(`lp creategroup ${group}`);
      created.push(group);
    }
    const verified = parseLpListGroups(await this.#execute('lp listgroups'));
    const stillMissing = [...this.managedGroups].filter((group) => !verified.has(group)).sort();
    const ok = stillMissing.length === 0;
    this.journal.record({ action: 'rank-groups-checked', ok, created, missing: stillMissing });
    return { ok, reason: ok ? '' : 'managed-groups-unverified', created, missing: stillMissing };
  }

  async parentInfo(mcUuid) {
    const uuid = this.#uuid(mcUuid);
    return parseLpParentInfo(await this.#execute(`lp user ${uuid} parent info`));
  }

  #uuid(mcUuid) {
    const uuid = normalizeUuid(mcUuid);
    if (!isRankSyncUuid(uuid)) throw new Error('A Java or Floodgate UUID is required for LuckPerms rank sync.');
    return uuid;
  }

  #plan(current, desired) {
    const adds = [...desired].filter((group) => !current.has(group)).sort();
    const removes = [...current].filter((group) => this.managedSubs.has(group) && !desired.has(group) && !PERMANENT_GROUPS.has(group)).sort();
    return { adds, removes };
  }

  reconcile(input = {}) {
    let uuid;
    try { uuid = this.#uuid(input.mcUuid); } catch (error) {
      return Promise.resolve({ ok: false, reason: 'uuid-not-syncable', message: error.message });
    }
    return this.#lane(uuid, () => this.#reconcile({ ...input, mcUuid: uuid }));
  }

  async #reconcile({ mcUuid, member, discordUserId = '', source = 'discord-role-sync', dryRun } = {}) {
    const planOnly = this.dryRun || dryRun === true;
    if (!planOnly && !this.writesEnabled) return { ok: false, reason: 'rank-sync-not-ready', discordUserId: clean(discordUserId, 32) };
    const desired = desiredGroups(member, this.roleMap);
    let current;
    try {
      current = await this.parentInfo(mcUuid);
    } catch (error) {
      this.journal.record({ action: 'rank-sync-failed', discordUserId: clean(discordUserId, 32), mcUuidDigest: uuidDigest(mcUuid), stage: 'read', response: redactIds(error?.message || error), source: clean(source, 64), dryRun: planOnly });
      return { ok: false, reason: 'parent-info-failed', discordUserId: clean(discordUserId, 32) };
    }
    const { adds, removes } = this.#plan(current, desired);
    const digest = uuidDigest(mcUuid);
    if (planOnly) {
      this.journal.record({
        action: 'rank-sync-planned',
        ok: true,
        dryRun: true,
        discordUserId: clean(discordUserId, 32),
        mcUuidDigest: digest,
        desired: [...desired].sort(),
        plannedAdds: adds,
        plannedRemoves: removes,
        source: clean(source, 64)
      });
      return {
        ok: true,
        dryRun: true,
        changed: false,
        discordUserId: clean(discordUserId, 32),
        desired: [...desired].sort(),
        plannedAdds: adds,
        plannedRemoves: removes,
        added: [],
        removed: []
      };
    }
    const added = [];
    for (const group of adds) {
      const response = await this.#execute(`lp user ${mcUuid} parent add ${group}`);
      current = await this.parentInfo(mcUuid);
      if (!current.has(group)) {
        this.journal.record({ action: 'rank-sync-failed', discordUserId: clean(discordUserId, 32), mcUuidDigest: digest, stage: 'add', group, response: redactIds(response), source: clean(source, 64) });
        return { ok: false, reason: 'rank-add-readback-failed', discordUserId: clean(discordUserId, 32), desired: [...desired].sort(), added, removed: [], plannedAdds: adds, plannedRemoves: removes };
      }
      added.push(group);
    }
    const removed = [];
    for (const group of removes) {
      const response = await this.#execute(`lp user ${mcUuid} parent remove ${group}`);
      current = await this.parentInfo(mcUuid);
      if (current.has(group)) {
        this.journal.record({ action: 'rank-sync-failed', discordUserId: clean(discordUserId, 32), mcUuidDigest: digest, stage: 'remove', group, response: redactIds(response), source: clean(source, 64) });
        return { ok: false, reason: 'stale-rank-remove-not-confirmed', discordUserId: clean(discordUserId, 32), desired: [...desired].sort(), added, removed, plannedAdds: adds, plannedRemoves: removes };
      }
      removed.push(group);
    }
    const missing = [...desired].filter((group) => !current.has(group));
    const stale = [...current].filter((group) => this.managedSubs.has(group) && !desired.has(group) && !PERMANENT_GROUPS.has(group));
    const ok = missing.length === 0 && stale.length === 0;
    this.journal.record({
      action: 'rank-synchronized',
      ok,
      discordUserId: clean(discordUserId, 32),
      mcUuidDigest: digest,
      desired: [...desired].sort(),
      added,
      removed,
      source: clean(source, 64)
    });
    return {
      ok,
      reason: ok ? '' : 'rank-readback-failed',
      dryRun: false,
      changed: Boolean(added.length || removed.length),
      discordUserId: clean(discordUserId, 32),
      desired: [...desired].sort(),
      added,
      removed,
      plannedAdds: adds,
      plannedRemoves: removes,
      missing,
      stale
    };
  }

  revokeSubs(input = {}) {
    let uuid;
    try { uuid = this.#uuid(input.mcUuid); } catch {
      return Promise.resolve({ ok: false, reason: 'uuid-not-syncable' });
    }
    return this.#lane(uuid, () => this.#revokeSubs({ ...input, mcUuid: uuid }));
  }

  async #revokeSubs({ mcUuid, discordUserId = '', source = 'account-unlink' } = {}) {
    const digest = uuidDigest(mcUuid);
    let current;
    try {
      current = await this.parentInfo(mcUuid);
    } catch (error) {
      this.journal.record({ action: 'rank-revoke-failed', discordUserId: clean(discordUserId, 32), mcUuidDigest: digest, stage: 'read', response: redactIds(error?.message || error), source: clean(source, 64) });
      return { ok: false, reason: 'rank-revoke-not-verified' };
    }
    const subs = [...current].filter((group) => this.managedSubs.has(group) && !PERMANENT_GROUPS.has(group)).sort();
    if (this.dryRun) {
      this.journal.record({ action: 'rank-revoke-planned', ok: subs.length === 0, dryRun: true, discordUserId: clean(discordUserId, 32), mcUuidDigest: digest, plannedRemoves: subs, source: clean(source, 64) });
      if (subs.length) return { ok: false, reason: 'dry-run-revoke-unverified', plannedRemoves: subs, removed: [] };
      return { ok: true, dryRun: true, removed: [], plannedRemoves: [] };
    }
    if (!this.writesEnabled) return { ok: false, reason: 'rank-sync-not-ready' };
    const removed = [];
    for (const group of subs) {
      const response = await this.#execute(`lp user ${mcUuid} parent remove ${group}`);
      current = await this.parentInfo(mcUuid);
      if (current.has(group)) {
        this.journal.record({ action: 'rank-revoke-failed', discordUserId: clean(discordUserId, 32), mcUuidDigest: digest, stage: 'remove', group, response: redactIds(response), source: clean(source, 64) });
        return { ok: false, reason: 'rank-revoke-not-verified', removed, group };
      }
      removed.push(group);
    }
    const remaining = [...current].filter((group) => this.managedSubs.has(group) && !PERMANENT_GROUPS.has(group));
    const ok = remaining.length === 0;
    this.journal.record({ action: 'rank-revoked', ok, discordUserId: clean(discordUserId, 32), mcUuidDigest: digest, removed, source: clean(source, 64) });
    return { ok, reason: ok ? '' : 'rank-revoke-not-verified', removed, remaining };
  }
}

function formatRankReport({ title, dryRun, rows = [], summary = {} } = {}) {
  const lines = [
    `**${title}**`,
    dryRun ? 'Dry run: no LuckPerms writes were sent.' : 'Live LuckPerms sync.',
    ''
  ];
  for (const row of rows.slice(0, 20)) {
    const adds = (row.plannedAdds || row.added || []).filter(Boolean);
    const removes = (row.plannedRemoves || row.removed || []).filter(Boolean);
    const parts = [];
    if (dryRun && adds.length) parts.push(`add ${adds.join(', ')}`);
    if (dryRun && removes.length) parts.push(`remove ${removes.join(', ')}`);
    if (!dryRun && row.changed) {
      if ((row.added || []).length) parts.push(`added ${row.added.join(', ')}`);
      if ((row.removed || []).length) parts.push(`removed ${row.removed.join(', ')}`);
    }
    const detail = row.ok === false
      ? (row.reason || 'failed')
      : (parts.join('; ') || 'in sync');
    lines.push(`\`${row.discordUserId || 'unknown'}\` ${detail}`);
  }
  if (rows.length > 20) lines.push(`…${rows.length - 20} more`);
  lines.push('', `Links ${summary.links || 0} • changed ${summary.changed || 0} • planned ${summary.planned || 0} • failed ${summary.failed || 0}`);
  return lines.join('\n').slice(0, 1900);
}

function startMcRankSync({ client, store, env = process.env, guildId = '', points = null, log = console } = {}) {
  const config = mcRankSyncConfig(env);
  const controller = {
    enabled: config.enabled,
    config,
    sync: null,
    points: null,
    lastError: '',
    started: false,
    async beforeUnlink() { return { ok: true, skipped: true }; },
    async syncMember() { return { ok: true, skipped: 'disabled' }; },
    async preview() { return { ok: false, reason: 'rank-sync-disabled', rows: [], summary: { links: 0, changed: 0, planned: 0, failed: 0 } }; },
    async syncNow() { return { ok: false, reason: 'rank-sync-disabled', rows: [], summary: { links: 0, changed: 0, planned: 0, failed: 0 } }; },
    async start() { return controller; }
  };
  if (!config.enabled) return controller;

  const linkedPoints = points || (economyConfigured(env) ? require('./mc-economy-http.cjs').httpMinecraftPoints(env) : null);
  controller.points = linkedPoints;
  controller.beforeUnlink = async ({ mcUuid, discordUserId, source = 'account-unlink' } = {}) => {
    if (!controller.sync?.ready) return { ok: false, reason: 'rank-sync-not-ready' };
    return controller.sync.revokeSubs({ mcUuid, discordUserId, source });
  };
  controller.syncMember = async (member, source = 'discord-role-sync', mcUuid = '') => {
    if (!controller.sync) return { ok: false, reason: 'rank-sync-not-ready' };
    const discordUserId = String(member?.id || member?.user?.id || '').trim();
    let uuid = normalizeUuid(mcUuid);
    if (!isRankSyncUuid(uuid)) {
      if (!linkedPoints?.status) return { ok: false, reason: 'link-status-unavailable' };
      let status;
      try { status = await linkedPoints.status({ discordUserId }); } catch {
        return { ok: false, reason: 'link-status-unavailable' };
      }
      if (!status?.linked || !isRankSyncUuid(status.mcUuid)) return { ok: true, skipped: 'not-linked' };
      uuid = normalizeUuid(status.mcUuid);
    }
    return controller.sync.reconcile({ mcUuid: uuid, member, discordUserId, source });
  };
  controller.preview = (input = {}) => reconcileLinked(controller, { ...input, dryRun: true, source: input.source || 'staff-preview' });
  controller.syncNow = (input = {}) => {
    if (!controller.sync?.ready && !controller.sync?.dryRun) {
      return Promise.resolve({ ok: false, reason: 'rank-sync-not-ready', rows: [], summary: { links: 0, changed: 0, planned: 0, failed: 1 } });
    }
    return reconcileLinked(controller, { ...input, dryRun: Boolean(controller.sync?.dryRun), source: input.source || 'staff-command' });
  };

  controller.start = async function start() {
    if (controller.started) return controller;
    controller.started = true;
    if (!linkedPoints) {
      controller.lastError = 'Nexus economy worker is not configured.';
      warn(log, `[Nexus Craft] mc rank sync blocked: ${controller.lastError}`);
      return controller;
    }
    if (!SERVER_NAME.test(config.serverName)) {
      controller.lastError = 'MC_RANK_SYNC_SERVER is not set to a saved /mcrcon server name.';
      warn(log, `[Nexus Craft] mc rank sync blocked: ${controller.lastError}`);
      return controller;
    }
    let server;
    try { server = store?.getServer?.(config.serverName); } catch (error) {
      controller.lastError = clean(error?.message || error, 160);
      warn(log, `[Nexus Craft] mc rank sync blocked: ${controller.lastError}`);
      return controller;
    }
    if (!server?.host || !server.port || !server.password) {
      controller.lastError = `RCON for ${config.serverName} is not saved. Staff use /mcrcon setup.`;
      warn(log, `[Nexus Craft] mc rank sync blocked: ${controller.lastError}`);
      return controller;
    }
    let roleMap;
    try { roleMap = roleMapFromEnv(env.MC_RANK_ROLE_MAP_JSON); } catch (error) {
      controller.lastError = clean(error?.message || error, 160);
      warn(log, `[Nexus Craft] mc rank sync blocked: ${controller.lastError}`);
      return controller;
    }
    const { runRcon } = require('./query.cjs');
    controller.sync = new McLuckPermsRankSync({
      rcon: { execute: (command) => runRcon(server, command) },
      roleMap,
      provisionGroups: config.provisionGroups,
      dryRun: config.dryRun,
      journal: new McRankSyncJournal()
    });
    let preflight;
    try { preflight = await controller.sync.ensureGroups(); } catch (error) {
      controller.lastError = clean(error?.message || error, 160);
      warn(log, `[Nexus Craft] mc rank sync preflight failed: ${controller.lastError}`);
      return controller;
    }
    controller.sync.markReady(preflight.ok);
    if (!preflight.ok) {
      controller.lastError = `managed groups missing: ${(preflight.missing || []).join(',') || preflight.reason}`;
      warn(log, `[Nexus Craft] mc rank sync writes disabled: ${controller.lastError}`);
      return controller;
    }
    log.log(`[Nexus Craft] mc rank sync ready: server=${config.serverName} dryRun=${config.dryRun} groups=${controller.sync.managedGroups.size}`);
    if (client && !client[RANK_LOOP]) {
      const run = () => {
        void reconcileLinked(controller, { source: 'periodic', dryRun: controller.sync.dryRun }).catch((error) => {
          warn(log, `[Nexus Craft] mc rank reconcile ${clean(error?.message || error, 160)}`);
        });
      };
      void reconcileLinked(controller, { source: 'startup', dryRun: controller.sync.dryRun }).catch((error) => {
        warn(log, `[Nexus Craft] mc rank startup ${clean(error?.message || error, 160)}`);
      });
      const timer = setInterval(run, config.intervalMinutes * 60 * 1000);
      if (typeof timer.unref === 'function') timer.unref();
      client[RANK_LOOP] = timer;
    }
    return controller;
  };
  return controller;
}

async function reconcileLinked(controller, { source = 'periodic', dryRun = false, discordUserId = '', member = null } = {}) {
  const sync = controller.sync;
  const points = controller.points;
  if (!sync || !points?.listLinks) {
    return { ok: false, reason: 'rank-sync-not-ready', dryRun: Boolean(dryRun), rows: [], summary: { links: 0, changed: 0, planned: 0, failed: 1 } };
  }
  const only = String(discordUserId || '').trim();
  let links = [];
  try {
    const listed = await points.listLinks();
    links = Array.isArray(listed) ? listed : (Array.isArray(listed?.links) ? listed.links : []);
  } catch {
    links = [];
    if (!only) return { ok: false, reason: 'links-unavailable', dryRun: Boolean(dryRun), rows: [], summary: { links: 0, changed: 0, planned: 0, failed: 1 } };
  }
  links = links.filter((link) => isRankSyncUuid(link?.mcUuid) && (!only || String(link.discordUserId) === only));
  if (only && !links.length && points.status) {
    try {
      const status = await points.status({ discordUserId: only });
      if (status?.linked && isRankSyncUuid(status.mcUuid)) links = [{ discordUserId: only, mcUuid: status.mcUuid }];
    } catch { /* status is optional when the list already answered */ }
  }
  const summary = { links: links.length, changed: 0, planned: 0, failed: 0 };
  const rows = [];
  let guild = null;
  if (controller.client && controller.guildId) {
    try { guild = await controller.client.guilds.fetch(controller.guildId); } catch { guild = null; }
  }
  for (const link of links) {
    const id = String(link.discordUserId);
    let target = member && String(member.id || member.user?.id || '') === id ? member : null;
    let leftGuild = false;
    if (!target && guild?.members?.fetch) {
      try { target = await guild.members.fetch(id); } catch (error) {
        const code = Number(error?.code);
        leftGuild = code === 10007 || code === 10013;
        if (!leftGuild) {
          summary.failed += 1;
          rows.push({ ok: false, reason: 'member-unavailable', discordUserId: id, plannedAdds: [], plannedRemoves: [], added: [], removed: [] });
          continue;
        }
      }
    }
    if (!target && !leftGuild) {
      summary.failed += 1;
      rows.push({ ok: false, reason: 'member-unavailable', discordUserId: id, plannedAdds: [], plannedRemoves: [], added: [], removed: [] });
      continue;
    }
    const result = await sync.reconcile({
      mcUuid: link.mcUuid,
      member: target,
      discordUserId: String(link.discordUserId),
      source,
      dryRun
    });
    if (!result.ok) summary.failed += 1;
    if (result.changed) summary.changed += 1;
    if ((result.plannedAdds || []).length || (result.plannedRemoves || []).length) summary.planned += 1;
    rows.push({ ...result, discordUserId: String(link.discordUserId) });
  }
  const report = { ok: summary.failed === 0, dryRun: Boolean(dryRun) || Boolean(sync.dryRun), rows, summary };
  console.log(`[Nexus Craft] mc rank reconcile (${source}): links=${summary.links} changed=${summary.changed} planned=${summary.planned} failed=${summary.failed} dryRun=${report.dryRun}`);
  return report;
}

// The client used for member fetch is attached by the bot after construction.
function bindRankSyncClient(controller, client, guildId) {
  if (!controller) return controller;
  controller.client = client;
  controller.guildId = String(guildId || '');
  return controller;
}

module.exports = {
  DEFAULT_ROLE_MAP,
  RANK_LADDER,
  SUB_LADDER,
  PERMANENT_GROUPS,
  MAX_AUDIT_ENTRIES,
  validGroupName,
  mcRankSyncConfig,
  roleMapFromEnv,
  memberRoleIds,
  rolesChanged,
  desiredGroups,
  parseLpListGroups,
  parseLpParentInfo,
  uuidDigest,
  McRankSyncJournal,
  McLuckPermsRankSync,
  formatRankReport,
  startMcRankSync,
  bindRankSyncClient
};

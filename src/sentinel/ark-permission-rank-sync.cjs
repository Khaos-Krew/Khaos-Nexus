'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { NEXUS_RANKS, rankById } = require('../shared/ranks.cjs');

const DEFAULT_RANK_GROUPS = Object.freeze({
  'shadow-recruit': 'NexusShadowRecruit',
  'cipher-runner': 'NexusCipherRunner',
  'nexus-raider': 'NexusRaider',
  'khaos-warden': 'NexusKhaosWarden',
  'blackout-legend': 'NexusBlackoutLegend',
  'origin-founder': 'NexusOriginFounder'
});
const MAX_AUDIT_ENTRIES = 10_000;

function clean(value, max = 128) {
  return String(value || '').replace(/[\r\n\t\u0000-\u001f]+/g, '').trim().slice(0, max);
}

function validGroupName(value) {
  return /^[A-Za-z][A-Za-z0-9_-]{2,47}$/.test(clean(value, 48));
}

function rankGroupsFromEnv(value = process.env.ARK_GEN1_RANK_GROUPS_JSON) {
  let overrides = {};
  if (String(value || '').trim()) {
    try { overrides = JSON.parse(String(value)); } catch { throw new Error('ARK_GEN1_RANK_GROUPS_JSON must be valid JSON.'); }
  }
  const result = {};
  for (const rank of NEXUS_RANKS) {
    const group = clean(overrides?.[rank.id] || DEFAULT_RANK_GROUPS[rank.id], 48);
    if (!validGroupName(group)) throw new Error(`Invalid ARK Permissions group for ${rank.id}.`);
    result[rank.id] = group;
  }
  if (new Set(Object.values(result).map((item) => item.toLowerCase())).size !== NEXUS_RANKS.length) {
    throw new Error('Each Nexus rank must map to a unique ARK Permissions group.');
  }
  return result;
}

function parseListGroups(response = '') {
  const groups = new Set();
  for (const raw of String(response || '').split(/\r?\n/)) {
    const match = raw.trim().match(/^\d+\)\s+([^\s]+)\s+-/);
    if (match && validGroupName(match[1])) groups.add(match[1]);
  }
  return groups;
}

function parsePlayerGroups(response = '') {
  const groups = new Set();
  const text = String(response || '').replace(/^Tribe Permissions:\s*/gim, '');
  for (const token of text.split(/[,\r\n]+/)) {
    const group = clean(token.replace(/\s+-\s+(?:Activates|Ends)\s+in.*$/i, ''), 48);
    if (validGroupName(group)) groups.add(group);
  }
  return groups;
}

function effectiveRankConfig(config = {}, adminSettings = {}) {
  const savedRoles = Object.fromEntries(Object.entries(adminSettings.rankRoles || {}).filter(([, value]) => clean(value, 32)));
  const savedSkus = Object.fromEntries(Object.entries(adminSettings.rankSkus || {}).filter(([, value]) => Array.isArray(value) && value.some((item) => clean(item, 32))));
  return {
    ...config,
    discord: {
      ...(config.discord || {}),
      rankRoles: { ...(config.discord?.rankRoles || {}), ...savedRoles },
      rankSkus: { ...(config.discord?.rankSkus || {}), ...savedSkus }
    }
  };
}

class ArkRankSyncJournal {
  constructor(options = {}) {
    const root = options.root || process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..', 'data');
    this.file = path.join(path.resolve(root), 'ark-rank-sync-audit.json');
    this.now = typeof options.now === 'function' ? options.now : Date.now;
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return { version: 1, entries: Array.isArray(parsed.entries) ? parsed.entries.slice(-MAX_AUDIT_ENTRIES) : [] };
    } catch { return { version: 1, entries: [] }; }
  }

  record(entry = {}) {
    const state = this.read();
    state.entries.push({ id: crypto.randomUUID(), at: new Date(this.now()).toISOString(), ...entry });
    state.entries = state.entries.slice(-MAX_AUDIT_ENTRIES);
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
    return state.entries.at(-1);
  }
}

class ArkPermissionRankSync {
  constructor({ rcon, groups, journal, provisionGroups = false } = {}) {
    if (!rcon?.execute) throw new Error('ArkPermissionRankSync requires an RCON client.');
    this.rcon = rcon;
    this.groups = groups || rankGroupsFromEnv();
    this.managedGroups = new Set(Object.values(this.groups));
    this.journal = journal || new ArkRankSyncJournal();
    this.provisionGroups = Boolean(provisionGroups);
    this.lanes = new Map();
  }

  async ensureGroups() {
    let existing = parseListGroups(await this.rcon.execute('Permissions.ListGroups'));
    const created = [];
    const missing = [...this.managedGroups].filter((group) => !existing.has(group));
    if (missing.length && !this.provisionGroups) {
      return { ok: false, reason: 'managed-groups-missing', missing, created };
    }
    for (const group of missing) {
      const response = await this.rcon.execute(`Permissions.AddGroup ${group}`);
      if (!/successfully added group/i.test(String(response || ''))) {
        this.journal.record({ action: 'rank-group-provision-failed', group, response: clean(response, 160) });
        return { ok: false, reason: 'group-create-not-confirmed', group, missing, created };
      }
      created.push(group);
    }
    if (created.length) existing = parseListGroups(await this.rcon.execute('Permissions.ListGroups'));
    const unverified = [...this.managedGroups].filter((group) => !existing.has(group));
    const ok = unverified.length === 0;
    this.journal.record({ action: 'rank-groups-checked', ok, created, missing: unverified });
    return { ok, reason: ok ? '' : 'managed-groups-unverified', created, missing: unverified };
  }

  playerGroups(eosId) {
    const eos = clean(eosId);
    if (!/^[A-Za-z0-9_-]{8,128}$/.test(eos)) throw new Error('A valid EOS ID is required for ARK rank synchronization.');
    return this.rcon.execute(`Permissions.PlayerGroups ${eos}`).then(parsePlayerGroups);
  }

  reconcile({ eosId, rankId, discordUserId = '', source = 'discord-role-sync' } = {}) {
    const eos = clean(eosId);
    const prior = this.lanes.get(eos) || Promise.resolve();
    const task = prior.catch(() => {}).then(() => this.#reconcile({ eosId: eos, rankId, discordUserId, source }));
    this.lanes.set(eos, task);
    return task.finally(() => { if (this.lanes.get(eos) === task) this.lanes.delete(eos); });
  }

  async #reconcile({ eosId, rankId, discordUserId, source }) {
    const rank = rankById(rankId);
    if (!rank) throw new Error('A recognized Nexus rank is required for ARK rank synchronization.');
    const desired = this.groups[rank.id];
    let current = await this.playerGroups(eosId);
    const added = [];
    const removed = [];
    if (!current.has(desired)) {
      const response = await this.rcon.execute(`Permissions.Add ${eosId} ${desired}`);
      if (!/successfully added player/i.test(String(response || ''))) {
        this.journal.record({ action: 'rank-sync-failed', discordUserId: clean(discordUserId, 32), eosDigest: crypto.createHash('sha256').update(eosId).digest('hex'), rankId: rank.id, stage: 'add', response: clean(response, 160), source: clean(source, 64) });
        return { ok: false, reason: 'rank-add-not-confirmed', rankId: rank.id, desired, added, removed };
      }
      current = await this.playerGroups(eosId);
      if (!current.has(desired)) return { ok: false, reason: 'rank-add-readback-failed', rankId: rank.id, desired, added, removed };
      added.push(desired);
    }
    for (const group of [...current]) {
      if (group === desired || !this.managedGroups.has(group)) continue;
      const response = await this.rcon.execute(`Permissions.Remove ${eosId} ${group}`);
      if (!/successfully removed player/i.test(String(response || ''))) {
        this.journal.record({ action: 'rank-sync-failed', discordUserId: clean(discordUserId, 32), eosDigest: crypto.createHash('sha256').update(eosId).digest('hex'), rankId: rank.id, stage: 'remove', group, response: clean(response, 160), source: clean(source, 64) });
        return { ok: false, reason: 'stale-rank-remove-not-confirmed', rankId: rank.id, desired, added, removed };
      }
      removed.push(group);
    }
    const verified = await this.playerGroups(eosId);
    const stale = [...verified].filter((group) => group !== desired && this.managedGroups.has(group));
    const ok = verified.has(desired) && stale.length === 0;
    this.journal.record({ action: 'rank-synchronized', ok, discordUserId: clean(discordUserId, 32), eosDigest: crypto.createHash('sha256').update(eosId).digest('hex'), rankId: rank.id, group: desired, added, removed, source: clean(source, 64) });
    return { ok, reason: ok ? '' : 'rank-readback-failed', changed: Boolean(added.length || removed.length), rankId: rank.id, desired, added, removed, stale };
  }

  async revoke({ eosId, discordUserId = '', source = 'account-unlink' } = {}) {
    const eos = clean(eosId);
    const current = await this.playerGroups(eos);
    const removed = [];
    for (const group of [...current]) {
      if (!this.managedGroups.has(group)) continue;
      const response = await this.rcon.execute(`Permissions.Remove ${eos} ${group}`);
      if (!/successfully removed player/i.test(String(response || ''))) return { ok: false, reason: 'rank-revoke-not-confirmed', removed, group };
      removed.push(group);
    }
    const remaining = [...await this.playerGroups(eos)].filter((group) => this.managedGroups.has(group));
    const ok = remaining.length === 0;
    this.journal.record({ action: 'rank-revoked', ok, discordUserId: clean(discordUserId, 32), eosDigest: crypto.createHash('sha256').update(eos).digest('hex'), removed, source: clean(source, 64) });
    return { ok, reason: ok ? '' : 'rank-revoke-readback-failed', removed, remaining };
  }
}

module.exports = {
  DEFAULT_RANK_GROUPS,
  validGroupName,
  rankGroupsFromEnv,
  parseListGroups,
  parsePlayerGroups,
  effectiveRankConfig,
  ArkRankSyncJournal,
  ArkPermissionRankSync
};

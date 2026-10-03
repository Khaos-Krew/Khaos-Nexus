'use strict';

const { DatabaseSync } = require('node:sqlite');

const TABLES = new Set([
  'DestinyMilestoneDefinition',
  'DestinyVendorDefinition',
  'DestinyInventoryItemDefinition',
  'DestinyActivityDefinition',
  'DestinyActivityModeDefinition',
  'DestinyClassDefinition'
]);

function hashKeys(hash) {
  const numeric = Number(hash);
  if (!Number.isFinite(numeric)) return [];
  const unsigned = numeric >>> 0;
  const signed = unsigned > 0x7fffffff ? unsigned - 0x100000000 : unsigned;
  return [...new Set([signed, unsigned])];
}

function displayName(definition) {
  return String(definition?.displayProperties?.name || '').trim();
}

function createManifestQuery() {
  let db = null;
  let openPath = '';

  function close() {
    try {
      db?.close();
    } catch {
      db = null;
    }
    db = null;
    openPath = '';
  }

  function open(file) {
    const next = String(file || '');
    if (!next) {
      close();
      return false;
    }
    if (db && openPath === next) return true;
    close();
    db = new DatabaseSync(next, { readOnly: true, allowExtension: false });
    openPath = next;
    return true;
  }

  function tableExists(name) {
    if (!db || !TABLES.has(name)) return false;
    const row = db.prepare("SELECT 1 AS ok FROM sqlite_master WHERE type = 'table' AND name = ?").get(name);
    return Boolean(row);
  }

  function definition(table, hash) {
    if (!db || !TABLES.has(table) || !tableExists(table)) return null;
    const statement = db.prepare(`SELECT json FROM ${table} WHERE id = ?`);
    for (const key of hashKeys(hash)) {
      const row = statement.get(key);
      if (!row?.json) continue;
      try {
        return JSON.parse(row.json);
      } catch {
        return null;
      }
    }
    return null;
  }

  function nameFor(table, hash) {
    return displayName(definition(table, hash));
  }

  function itemMeta(table, hash) {
    const row = definition(table, hash);
    if (!row) return null;
    const inventory = row.inventory && typeof row.inventory === 'object' ? row.inventory : null;
    return {
      name: displayName(row),
      itemType: Number(row.itemType) || 0,
      tierType: Number(inventory?.tierType ?? row.tierType) || 0,
      tierTypeName: String(inventory?.tierTypeName || row.tierTypeName || ''),
      bucketTypeHash: Number(inventory?.bucketTypeHash) || 0,
      redacted: row.redacted === true,
      displayCategory: row.displayCategory === true || row.vendorDisplayCategory === true
    };
  }

  function readAll(table) {
    if (!tableExists(table)) return [];
    const rows = db.prepare(`SELECT json FROM ${table}`).all();
    const parsed = [];
    for (const row of rows) {
      try {
        parsed.push(JSON.parse(row.json));
      } catch {
        parsed.push(null);
      }
    }
    return parsed.filter(Boolean);
  }

  function activityModes() {
    return readAll('DestinyActivityModeDefinition').map((row) => ({
      hash: row.hash,
      name: displayName(row),
      modeType: Number(row.modeType) || 0,
      source: 'mode'
    })).filter((row) => row.name);
  }

  function searchActivities(query, limit = 25) {
    const needle = String(query || '').trim().toLowerCase();
    const cap = Math.max(1, Math.min(25, Number(limit) || 25));
    if (!db) return [];
    if (!needle) return activityModes().slice(0, cap);
    const matches = [];
    if (tableExists('DestinyActivityDefinition')) {
      const like = `%${needle.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
      try {
        const rows = db.prepare(
          "SELECT json FROM DestinyActivityDefinition WHERE json_extract(json, '$.displayProperties.name') LIKE ? ESCAPE '\\' LIMIT ?"
        ).all(like, cap);
        for (const row of rows) {
          const parsed = JSON.parse(row.json);
          const name = displayName(parsed);
          if (!name) continue;
          matches.push({
            hash: parsed.hash,
            name,
            modeType: Number(parsed.directActivityModeType) || 0,
            source: 'activity'
          });
        }
      } catch {
        matches.length = 0;
      }
    }
    if (!matches.length) {
      for (const mode of activityModes()) {
        if (mode.name.toLowerCase().includes(needle)) matches.push(mode);
      }
    }
    return matches.slice(0, cap);
  }

  return { open, close, definition, nameFor, itemMeta, activityModes, searchActivities, hashKeys };
}

module.exports = {
  TABLES,
  hashKeys,
  displayName,
  createManifestQuery
};

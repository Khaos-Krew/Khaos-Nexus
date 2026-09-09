'use strict';

function normalizeErrors(errors = []) {
  return [...new Set((Array.isArray(errors) ? errors : []).filter(Boolean).map((value) => String(value).trim()).filter(Boolean))].sort();
}

function legacyHealthFromSnapshot(snapshot = {}) {
  const errors = normalizeErrors(snapshot.errors);
  return {
    serverId: String(snapshot.serverId || ''),
    serverName: String(snapshot.serverName || snapshot.serverId || 'ARK Server'),
    ok: errors.length === 0,
    degraded: errors.length > 0,
    version: snapshot.version || undefined,
    modCount: Array.isArray(snapshot.modIds) ? snapshot.modIds.length : 0,
    inventoryAvailable: snapshot.inventoryAvailable === true,
    errors,
  };
}

function compareArkHealth(v2 = {}, legacy = {}) {
  const fields = ['ok', 'degraded', 'version', 'modCount', 'inventoryAvailable'];
  const differences = [];
  for (const field of fields) {
    if ((v2[field] ?? null) !== (legacy[field] ?? null)) differences.push({ field, v2: v2[field] ?? null, legacy: legacy[field] ?? null });
  }
  const v2Errors = normalizeErrors(v2.errors);
  const legacyErrors = normalizeErrors(legacy.errors);
  if (JSON.stringify(v2Errors) !== JSON.stringify(legacyErrors)) differences.push({ field: 'errors', v2: v2Errors, legacy: legacyErrors });
  return { equivalent: differences.length === 0, differences };
}

function buildArkHealthEquivalenceReport(v2Results = [], legacySnapshots = []) {
  const legacyById = new Map((legacySnapshots || []).map((snapshot) => [String(snapshot?.serverId || ''), legacyHealthFromSnapshot(snapshot)]));
  const comparisons = [];
  for (const item of v2Results || []) {
    const v2 = item?.health || item || {};
    const serverId = String(v2.serverId || '');
    const legacy = legacyById.get(serverId);
    if (!legacy) {
      comparisons.push({ serverId, serverName: v2.serverName, equivalent: false, differences: [{ field: 'legacySnapshot', v2: 'present', legacy: 'missing' }] });
      continue;
    }
    const comparison = compareArkHealth(v2, legacy);
    comparisons.push({ serverId, serverName: v2.serverName || legacy.serverName, ...comparison });
    legacyById.delete(serverId);
  }
  for (const legacy of legacyById.values()) {
    comparisons.push({ serverId: legacy.serverId, serverName: legacy.serverName, equivalent: false, differences: [{ field: 'v2Snapshot', v2: 'missing', legacy: 'present' }] });
  }
  return {
    equivalent: comparisons.every((item) => item.equivalent),
    servers: comparisons.length,
    matched: comparisons.filter((item) => item.equivalent).length,
    drifted: comparisons.filter((item) => !item.equivalent).length,
    comparisons,
    checkedAt: new Date().toISOString(),
  };
}

module.exports = { normalizeErrors, legacyHealthFromSnapshot, compareArkHealth, buildArkHealthEquivalenceReport };

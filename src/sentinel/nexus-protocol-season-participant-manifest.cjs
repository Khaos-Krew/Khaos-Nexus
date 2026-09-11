'use strict';

const crypto = require('node:crypto');
const { verifyParticipantProgressSnapshot } = require('./nexus-protocol-participant-snapshot.cjs');

function cleanId(value, label) {
  const result = String(value ?? '').trim();
  if (!/^[A-Za-z0-9:_-]{1,96}$/.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}

function finiteNonNegative(value, label) {
  const number = Number(value ?? 0);
  if (!Number.isFinite(number) || number < 0) throw new Error(`Invalid ${label}`);
  return number;
}

function stablePayload(manifest) {
  return JSON.stringify({
    version: manifest.version,
    seasonId: manifest.seasonId,
    ledgerRevision: manifest.ledgerRevision,
    participantCount: manifest.participantCount,
    eligibleCount: manifest.eligibleCount,
    totalAwardedScore: manifest.totalAwardedScore,
    entries: manifest.entries
  });
}

function createSeasonParticipantManifest(season, snapshots = [], options = {}) {
  if (!season || !Array.isArray(snapshots)) throw new Error('Protocol season participant manifest requires season and snapshots');
  const seasonId = cleanId(season.id, 'season id');
  const expectedRunIds = new Set((options.runIds || []).map((value) => cleanId(value, 'protocol run id')));
  const seen = new Set();
  let ledgerRevision = null;
  const entries = snapshots.map((snapshot) => {
    if (!verifyParticipantProgressSnapshot(snapshot)) throw new Error('Invalid Protocol participant snapshot in season manifest');
    if (ledgerRevision === null) ledgerRevision = snapshot.ledgerRevision;
    if (snapshot.ledgerRevision !== ledgerRevision) throw new Error('Protocol season participant snapshots span ledger revisions');
    if (expectedRunIds.size && !expectedRunIds.has(snapshot.runId)) throw new Error('Protocol participant snapshot belongs to a run outside the season');
    const key = `${snapshot.runId}::${snapshot.accountId}`;
    if (seen.has(key)) throw new Error('Duplicate Protocol participant snapshot in season manifest');
    seen.add(key);
    return Object.freeze({
      runId: cleanId(snapshot.runId, 'protocol run id'),
      accountId: cleanId(snapshot.accountId, 'account id'),
      eligible: snapshot.eligible === true,
      score: finiteNonNegative(snapshot.score, 'Protocol Score'),
      rawScore: finiteNonNegative(snapshot.rawScore, 'raw Protocol Score'),
      processedEvents: Math.floor(finiteNonNegative(snapshot.processedEvents, 'processed event count')),
      snapshotDigest: String(snapshot.digest).toLowerCase()
    });
  }).sort((a, b) => a.runId.localeCompare(b.runId) || a.accountId.localeCompare(b.accountId));

  const revision = ledgerRevision ?? Math.floor(finiteNonNegative(options.ledgerRevision ?? 0, 'ledger revision'));
  if (options.ledgerRevision !== undefined && revision !== Math.floor(finiteNonNegative(options.ledgerRevision, 'ledger revision'))) {
    throw new Error('Protocol season participant manifest ledger revision mismatch');
  }
  const payload = {
    version: 1,
    seasonId,
    ledgerRevision: revision,
    participantCount: entries.length,
    eligibleCount: entries.filter((entry) => entry.eligible).length,
    totalAwardedScore: entries.reduce((total, entry) => total + entry.score, 0),
    entries: Object.freeze(entries)
  };
  return Object.freeze({
    ...payload,
    digest: crypto.createHash('sha256').update(stablePayload(payload)).digest('hex'),
    readOnly: true,
    rewardAuthority: false,
    mutatesPersistence: false
  });
}

function verifySeasonParticipantManifest(manifest) {
  if (!manifest || manifest.readOnly !== true || manifest.rewardAuthority !== false || manifest.mutatesPersistence !== false) return false;
  if (!/^[a-f0-9]{64}$/.test(String(manifest.digest || '').toLowerCase()) || !Array.isArray(manifest.entries)) return false;
  try {
    if (manifest.participantCount !== manifest.entries.length) return false;
    if (manifest.eligibleCount !== manifest.entries.filter((entry) => entry.eligible === true).length) return false;
    if (manifest.totalAwardedScore !== manifest.entries.reduce((total, entry) => total + finiteNonNegative(entry.score, 'Protocol Score'), 0)) return false;
    const seen = new Set();
    for (const entry of manifest.entries) {
      cleanId(entry.runId, 'protocol run id');
      cleanId(entry.accountId, 'account id');
      if (!/^[a-f0-9]{64}$/.test(String(entry.snapshotDigest || '').toLowerCase())) return false;
      const key = `${entry.runId}::${entry.accountId}`;
      if (seen.has(key)) return false;
      seen.add(key);
    }
    const expected = crypto.createHash('sha256').update(stablePayload(manifest)).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(String(manifest.digest).toLowerCase(), 'hex'), Buffer.from(expected, 'hex'));
  } catch {
    return false;
  }
}

module.exports = { createSeasonParticipantManifest, verifySeasonParticipantManifest };

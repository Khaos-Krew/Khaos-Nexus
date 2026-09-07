'use strict';

const crypto = require('node:crypto');
const { assertProtocolProgressCheckpoint } = require('./nexus-protocol-progress-checkpoint.cjs');

function cleanId(value, label) {
  const result = String(value ?? '').trim();
  if (!/^[A-Za-z0-9:_-]{1,96}$/.test(result)) throw new Error(`Invalid ${label}`);
  return result;
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
}

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function createSeasonCheckpointManifest(season, checkpoints = [], options = {}) {
  if (!season || !['active', 'closed'].includes(String(season.status || ''))) {
    throw new Error('Protocol season checkpoint manifest requires active or closed season');
  }
  if (!Array.isArray(checkpoints) || checkpoints.length === 0) {
    throw new Error('Protocol season checkpoint manifest requires checkpoints');
  }

  const seasonId = cleanId(season.id, 'season id');
  const storeRevision = Number(options.storeRevision);
  if (!Number.isSafeInteger(storeRevision) || storeRevision < 0) throw new Error('Invalid Protocol store revision');

  const runIds = new Set();
  const checkpointDigests = new Set();
  const entries = checkpoints.map((checkpoint) => {
    assertProtocolProgressCheckpoint(checkpoint);
    const runId = cleanId(checkpoint.runId, 'protocol run id');
    if (runIds.has(runId)) throw new Error('Duplicate Protocol run checkpoint');
    if (checkpointDigests.has(checkpoint.checkpointDigest)) throw new Error('Duplicate Protocol checkpoint digest');
    runIds.add(runId);
    checkpointDigests.add(checkpoint.checkpointDigest);
    return {
      runId,
      checkpointDigest: checkpoint.checkpointDigest,
      ledgerRevision: checkpoint.ledgerRevision,
      ledgerUpdatedAt: checkpoint.ledgerUpdatedAt,
      eventCount: checkpoint.eventCount,
      participantCount: checkpoint.participants.length
    };
  }).sort((a, b) => a.runId.localeCompare(b.runId));

  const payload = {
    version: 1,
    seasonId,
    seasonStatus: season.status,
    storeRevision,
    checkpointCount: entries.length,
    entries
  };
  return Object.freeze({ ...payload, manifestDigest: digest(payload) });
}

function assertSeasonCheckpointManifest(manifest, checkpoints = []) {
  if (!manifest || Number(manifest.version) !== 1
    || !/^[a-f0-9]{64}$/.test(String(manifest.manifestDigest || '').toLowerCase())) {
    throw new Error('Invalid Protocol season checkpoint manifest');
  }
  const { manifestDigest, ...payload } = manifest;
  const expected = digest(payload);
  if (!crypto.timingSafeEqual(Buffer.from(String(manifestDigest).toLowerCase(), 'hex'), Buffer.from(expected, 'hex'))) {
    throw new Error('Protocol season checkpoint manifest integrity mismatch');
  }

  const rebuilt = createSeasonCheckpointManifest(
    { id: manifest.seasonId, status: manifest.seasonStatus },
    checkpoints,
    { storeRevision: manifest.storeRevision }
  );
  if (rebuilt.manifestDigest !== manifest.manifestDigest) {
    throw new Error('Protocol season checkpoint manifest does not match checkpoint evidence');
  }
  return true;
}

module.exports = {
  createSeasonCheckpointManifest,
  assertSeasonCheckpointManifest
};

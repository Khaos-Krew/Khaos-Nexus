'use strict';

const crypto = require('node:crypto');
const { verifySeasonScoreSeal } = require('./nexus-protocol-score-seal.cjs');
const { verifySeasonParticipantManifest } = require('./nexus-protocol-season-participant-manifest.cjs');

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

function aggregateEligibleManifestScores(manifest) {
  const scores = new Map();
  for (const entry of manifest.entries) {
    if (entry.eligible !== true) continue;
    scores.set(entry.accountId, (scores.get(entry.accountId) || 0) + Number(entry.score || 0));
  }
  return scores;
}

function assertScoreParity(seal, manifest) {
  const manifestScores = aggregateEligibleManifestScores(manifest);
  const sealedScores = new Map(seal.entries.map((entry) => [entry.accountId, Number(entry.score)]));
  if (manifestScores.size !== sealedScores.size) throw new Error('Protocol season score seal does not match eligible participant manifest');
  for (const [accountId, score] of manifestScores) {
    if (!sealedScores.has(accountId) || sealedScores.get(accountId) !== score) {
      throw new Error('Protocol season score seal does not match eligible participant manifest');
    }
  }
}

function buildSeasonFinalizationAdmission(season, seal, manifest, options = {}) {
  if (!season || season.status !== 'closed') throw new Error('Protocol season finalization requires a closed season');
  if (!verifySeasonScoreSeal(seal)) throw new Error('Protocol season finalization requires a valid score seal');
  if (!verifySeasonParticipantManifest(manifest)) throw new Error('Protocol season finalization requires a valid participant manifest');

  const seasonId = cleanId(season.id, 'season id');
  if (seal.seasonId !== seasonId || manifest.seasonId !== seasonId) throw new Error('Protocol season finalization artifact season mismatch');
  assertScoreParity(seal, manifest);

  const admittedAt = Number(options.admittedAt ?? Date.now());
  if (!Number.isSafeInteger(admittedAt) || admittedAt < Number(seal.closedAt)) throw new Error('Invalid Protocol season finalization admission time');

  const payload = {
    version: 1,
    kind: 'nexus-protocol-season-finalization-admission',
    seasonId,
    scoreSealDigest: String(seal.digest).toLowerCase(),
    participantManifestDigest: String(manifest.digest).toLowerCase(),
    participantCount: manifest.participantCount,
    eligibleCount: manifest.eligibleCount,
    totalAwardedScore: manifest.totalAwardedScore,
    admittedAt,
    nextAction: 'prepare_read_only_season_publication',
    requiresSeparateRewardAuthorization: true,
    requiresSeparatePublicationCommit: true,
    readOnly: true,
    rewardAuthority: false,
    publicationAuthority: false,
    mutatesPersistence: false,
    executesCommands: false
  };
  return Object.freeze({ ...payload, digest: digest(payload) });
}

function verifySeasonFinalizationAdmission(admission, season, seal, manifest) {
  if (!admission || admission.kind !== 'nexus-protocol-season-finalization-admission'
    || admission.requiresSeparateRewardAuthorization !== true || admission.requiresSeparatePublicationCommit !== true
    || admission.readOnly !== true || admission.rewardAuthority !== false || admission.publicationAuthority !== false
    || admission.mutatesPersistence !== false || admission.executesCommands !== false
    || !/^[a-f0-9]{64}$/.test(String(admission.digest || '').toLowerCase())) return false;
  try {
    const expected = buildSeasonFinalizationAdmission(season, seal, manifest, { admittedAt: admission.admittedAt });
    return crypto.timingSafeEqual(Buffer.from(admission.digest, 'hex'), Buffer.from(expected.digest, 'hex'))
      && JSON.stringify(canonical(admission)) === JSON.stringify(canonical(expected));
  } catch {
    return false;
  }
}

module.exports = {
  buildSeasonFinalizationAdmission,
  verifySeasonFinalizationAdmission
};

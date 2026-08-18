'use strict';

const crypto = require('node:crypto');

function integrityMaterial(payload = {}) {
  return JSON.stringify({
    format: payload.format || '',
    formatVersion: Number(payload.formatVersion || 0),
    appVersion: String(payload.appVersion || ''),
    config: payload.config || {},
    encryptedSecrets: payload.encryptedSecrets || null
  });
}

function backupDigest(payload = {}) {
  return crypto.createHash('sha256').update(integrityMaterial(payload), 'utf8').digest('hex');
}

function attachBackupIntegrity(payload = {}) {
  return {
    ...payload,
    integrity: {
      algorithm: 'sha256',
      digest: backupDigest(payload)
    },
    product: {
      id: 'nexus-sentinel',
      scope: 'discord-palworld'
    }
  };
}

function validateBackupIntegrity(payload = {}) {
  const digest = String(payload?.integrity?.digest || '').trim().toLowerCase();
  if (!digest) return { valid: true, legacy: true, digest: null };
  if (String(payload?.integrity?.algorithm || '').toLowerCase() !== 'sha256' || !/^[a-f0-9]{64}$/.test(digest)) {
    return { valid: false, legacy: false, digest, reason: 'Invalid backup integrity metadata.' };
  }
  const actual = backupDigest(payload);
  return actual === digest
    ? { valid: true, legacy: false, digest }
    : { valid: false, legacy: false, digest, actual, reason: 'Backup SHA-256 integrity check failed.' };
}

module.exports = { integrityMaterial, backupDigest, attachBackupIntegrity, validateBackupIntegrity };
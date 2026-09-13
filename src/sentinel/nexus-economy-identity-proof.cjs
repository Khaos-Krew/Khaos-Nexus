'use strict';

const crypto = require('node:crypto');
const { validDiscordId, validEosId } = require('./ark-identity-store.cjs');

function payload(input) {
  const { discordUserId, eosId, verifiedAt, issuedAt } = input || {};
  if (typeof discordUserId !== 'string' || !validDiscordId(discordUserId) ||
      typeof eosId !== 'string' || !validEosId(eosId) ||
      discordUserId.trim() !== discordUserId || eosId.trim() !== eosId ||
      typeof verifiedAt !== 'string' || !Number.isFinite(Date.parse(verifiedAt)) ||
      !Number.isSafeInteger(issuedAt)) throw new Error('Invalid economic identity proof.');
  return JSON.stringify(['nexus-identity-v1', discordUserId, eosId, verifiedAt, issuedAt]);
}

function signIdentityProof(input, secret) {
  if (typeof secret !== 'string' || secret.length < 32) throw new Error('Economic identity proof signing is not configured.');
  return crypto.createHmac('sha256', secret).update(payload(input)).digest('hex');
}

function verifyIdentityProof(input, { secret, now = Date.now() } = {}) {
  const expected = signIdentityProof(input, secret);
  if (Math.abs(now - input.issuedAt) > 300_000 || Date.parse(input.verifiedAt) > now ||
      typeof input.proof !== 'string' || !/^[a-f0-9]{64}$/.test(input.proof) ||
      !crypto.timingSafeEqual(Buffer.from(input.proof, 'hex'), Buffer.from(expected, 'hex'))) {
    throw new Error('Economic identity proof is invalid or expired.');
  }
  return { discordUserId: input.discordUserId, eosId: input.eosId, verifiedAt: input.verifiedAt };
}

function withIdentityProof(input, account, { secret = process.env.NEXUS_ECONOMY_IDENTITY_PROOF_SECRET, now = Date.now() } = {}) {
  if (!secret) return input;
  const signed = { ...input, verifiedAt: account?.verifiedAt, issuedAt: now };
  return { ...signed, proof: signIdentityProof(signed, secret) };
}

module.exports = { signIdentityProof, verifyIdentityProof, withIdentityProof };

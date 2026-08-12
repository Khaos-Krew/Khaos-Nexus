'use strict';

const crypto = require('node:crypto');

const PALWORLD_DEDICATED_APP_ID = 2394010;
const DEFAULT_WARNING_MINUTES = Object.freeze([15, 10, 5, 2, 1]);
const MAX_PROFILES = 20;

function cleanText(value, max = 200, fallback = '') {
  const text = String(value ?? '').replace(/\u0000/g, '').trim();
  return (text || fallback).slice(0, max);
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, Math.round(number))) : fallback;
}

function normalizeId(value, prefix = 'palworld-update') {
  const raw = String(value || '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(raw) ? raw : `${prefix}-${crypto.randomUUID()}`;
}

function normalizeDiscordChannelId(value) {
  const id = cleanText(value, 25);
  if (id && !/^\d{5,25}$/.test(id)) throw new Error('Discord update channel ID must be numeric.');
  return id;
}

function normalizeServiceId(value) {
  const id = cleanText(value, 32);
  if (id && !/^\d{1,20}$/.test(id)) throw new Error('Nitrado Service ID must contain only digits.');
  return id;
}

function normalizeWarningMinutes(values) {
  const source = Array.isArray(values)
    ? values
    : String(values ?? '').split(',');
  const result = [...new Set(source
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && value >= 1 && value <= 120)
    .map((value) => Math.round(value)))]
    .sort((a, b) => b - a)
    .slice(0, 12);
  return result.length ? result : [...DEFAULT_WARNING_MINUTES];
}

function normalizeProfile(input = {}) {
  return {
    id: normalizeId(input.id),
    name: cleanText(input.name, 100, 'Palworld on Nitrado'),
    serverId: cleanText(input.serverId, 100),
    nitradoServiceId: normalizeServiceId(input.nitradoServiceId),
    enabled: input.enabled !== false,
    monitorUpdates: input.monitorUpdates !== false,
    autoApply: Boolean(input.autoApply),
    discordChannelId: normalizeDiscordChannelId(input.discordChannelId),
    checkIntervalMinutes: clampInteger(input.checkIntervalMinutes, 5, 1440, 15),
    stagingDelayMinutes: clampInteger(input.stagingDelayMinutes, 0, 720, 60),
    warningMinutes: normalizeWarningMinutes(input.warningMinutes),
    saveBeforeRestart: input.saveBeforeRestart !== false,
    saveDelaySeconds: clampInteger(input.saveDelaySeconds, 0, 120, 10),
    verifyTimeoutMinutes: clampInteger(input.verifyTimeoutMinutes, 2, 60, 15)
  };
}

function normalizeConfig(input = {}) {
  const seen = new Set();
  const profiles = [];
  for (const item of Array.isArray(input.profiles) ? input.profiles : []) {
    try {
      const profile = normalizeProfile(item);
      if (seen.has(profile.id)) continue;
      seen.add(profile.id);
      profiles.push(profile);
    } catch {}
  }
  return {
    schemaVersion: 1,
    profiles: profiles.slice(0, MAX_PROFILES)
  };
}

function normalizeCandidate(input = {}) {
  const stage = new Set(['detected', 'countdown', 'saving', 'restarting', 'verifying', 'success', 'failed', 'uncertain', 'cancelled']).has(input.stage)
    ? input.stage
    : 'detected';
  return {
    version: cleanText(input.version, 60),
    detectedAt: input.detectedAt ? String(input.detectedAt) : null,
    applyAfter: input.applyAfter ? String(input.applyAfter) : null,
    stage,
    source: input.source === 'manual' ? 'manual' : 'automatic',
    countdownStartedAt: input.countdownStartedAt ? String(input.countdownStartedAt) : null,
    restartAt: input.restartAt ? String(input.restartAt) : null,
    warningsSent: normalizeWarningMinutes(input.warningsSent || []).filter((value) => (input.warningsSent || []).map(Number).includes(value)),
    restartRequestedAt: input.restartRequestedAt ? String(input.restartRequestedAt) : null,
    verifyDeadline: input.verifyDeadline ? String(input.verifyDeadline) : null,
    offlineObserved: Boolean(input.offlineObserved),
    completedAt: input.completedAt ? String(input.completedAt) : null,
    summary: cleanText(input.summary, 700),
    operationId: cleanText(input.operationId, 180)
  };
}

function normalizeProfileState(input = {}) {
  return {
    baselineVersion: cleanText(input.baselineVersion, 60),
    lastRequiredVersion: cleanText(input.lastRequiredVersion, 60),
    lastCheckAt: input.lastCheckAt ? String(input.lastCheckAt) : null,
    nextCheckAt: input.nextCheckAt ? String(input.nextCheckAt) : null,
    lastNotifiedVersion: cleanText(input.lastNotifiedVersion, 60),
    lastAppliedVersion: cleanText(input.lastAppliedVersion, 60),
    lastNitradoVersion: cleanText(input.lastNitradoVersion, 120),
    lastNitradoStatus: cleanText(input.lastNitradoStatus, 80),
    lastError: cleanText(input.lastError, 700),
    candidate: input.candidate?.version ? normalizeCandidate(input.candidate) : null
  };
}

function warningText(profile, minutes, version) {
  const amount = Number(minutes) === 1 ? '1 minute' : `${Math.max(1, Number(minutes) || 1)} minutes`;
  return `Palworld server update ${cleanText(version, 60, 'available')} will be applied in ${amount}. Please finish what you are doing and prepare to reconnect.`;
}

function finalWarningText(version) {
  return `Palworld update ${cleanText(version, 60, 'available')} is being applied now. Saving the world and restarting the server.`;
}

function publicProfile(profile, hasToken = false) {
  return { ...normalizeProfile(profile), hasToken: Boolean(hasToken) };
}

module.exports = {
  PALWORLD_DEDICATED_APP_ID,
  DEFAULT_WARNING_MINUTES,
  MAX_PROFILES,
  cleanText,
  clampInteger,
  normalizeId,
  normalizeDiscordChannelId,
  normalizeServiceId,
  normalizeWarningMinutes,
  normalizeProfile,
  normalizeConfig,
  normalizeCandidate,
  normalizeProfileState,
  warningText,
  finalWarningText,
  publicProfile
};

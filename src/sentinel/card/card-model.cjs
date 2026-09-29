'use strict';

const { levelFromXp } = require('./level-math.cjs');
const { highestConfiguredRankForMember } = require('../ark-account-linking.cjs');
const { readEquippedCosmetics } = require('./cosmetics-adapter.cjs');

function withTimeout(promise, timeoutMs) {
  return new Promise((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve({ ok: false, reason: 'timeout' });
    }, timeoutMs);
    Promise.resolve()
      .then(() => promise)
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: true, value });
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ ok: false, reason: 'error' });
      });
  });
}

function unavailable(reason = 'unavailable') {
  return { unavailable: true, reason };
}

function filterForViewer(model, { viewerId, targetUserId, allowBalances = false } = {}) {
  const viewer = String(viewerId || '');
  const target = String(targetUserId || '');
  if (model?.hidden === true && viewer !== target) {
    return { hidden: true, viewerId: viewer, targetUserId: target };
  }
  const permitted = allowBalances === true && viewer !== '' && viewer === target;
  return {
    hidden: false,
    viewerId: viewer,
    targetUserId: target,
    allowBalances: permitted,
    level: model?.level || unavailable(),
    rank: model?.rank || unavailable(),
    cosmetics: model?.cosmetics || unavailable(),
    tags: model?.tags?.unavailable ? unavailable() : (model?.tags || {}),
    balances: permitted ? (model?.balances || unavailable()) : null
  };
}

function balancesPermitted(surface, viewerId, targetUserId) {
  if (String(viewerId || '') !== String(targetUserId || '')) return false;
  return surface === 'own' || surface === 'view-button';
}

async function assembleCardModel({
  viewerId,
  targetUserId,
  allowBalances = false,
  readers,
  timeoutMs = 1500
} = {}) {
  const viewer = String(viewerId || '');
  const target = String(targetUserId || '');
  const wantBalances = allowBalances === true && viewer !== '' && viewer === target;
  const [prefs, xp, rank, cosmetics, balances] = await Promise.all([
    withTimeout(readers.prefs(), timeoutMs),
    withTimeout(readers.xp(), timeoutMs),
    withTimeout(readers.rank(), timeoutMs),
    withTimeout(readers.cosmetics(), timeoutMs),
    wantBalances ? withTimeout(readers.balances(), timeoutMs) : Promise.resolve({ ok: false, skipped: true })
  ]);

  const hidden = prefs.ok && prefs.value?.hidden === true;
  if (hidden && viewer !== target) {
    return { hidden: true, viewerId: viewer, targetUserId: target };
  }

  return filterForViewer({
    hidden: false,
    level: xp.ok ? { unavailable: false, ...xp.value } : unavailable(xp.reason),
    rank: rank.ok ? { unavailable: false, ...rank.value } : unavailable(rank.reason),
    cosmetics: cosmetics.ok ? { unavailable: false, ...cosmetics.value } : unavailable(cosmetics.reason),
    tags: prefs.ok ? (prefs.value?.tags || {}) : unavailable(prefs.reason),
    balances: wantBalances
      ? (balances.ok ? { unavailable: false, ...balances.value } : unavailable(balances.reason))
      : null
  }, { viewerId: viewer, targetUserId: target, allowBalances: wantBalances });
}

function whole(value) {
  const amount = Number(value || 0);
  return Number.isSafeInteger(amount) && amount >= 0 ? amount : 0;
}

async function readXp(backend, userId) {
  if (typeof backend?.communityLevel !== 'function') throw new Error('xp-unavailable');
  const response = await backend.communityLevel(String(userId));
  if (!response?.ok) throw new Error('xp-unavailable');
  return levelFromXp(response.profile?.xp ?? 0);
}

async function readRank(interaction, config, targetUserId) {
  let member = null;
  const memberId = String(interaction?.member?.id || interaction?.member?.user?.id || '');
  if (memberId && memberId === String(targetUserId)) member = interaction.member;
  else if (typeof interaction?.guild?.members?.fetch === 'function') {
    member = await interaction.guild.members.fetch(String(targetUserId));
  }
  if (!member) throw new Error('rank-unavailable');
  const rank = highestConfiguredRankForMember(member, config || {});
  if (!rank?.name) throw new Error('rank-unavailable');
  return { id: rank.id, name: rank.name };
}

async function readBalances(economy, userId) {
  if (!economy || (typeof economy.configured === 'function' && economy.configured() === false)) {
    throw new Error('balances-unavailable');
  }
  if (typeof economy.balances !== 'function') throw new Error('balances-unavailable');
  const result = await economy.balances(String(userId));
  const balances = result?.balances || {};
  return {
    coins: whole(balances.NEXUS_COINS),
    points: whole(balances.NEXUS_POINTS),
    cacheTokens: whole(balances.DINO_CACHE_TOKENS)
  };
}

function buildReaders({ backend, economy, store, config, interaction, targetUserId }) {
  return {
    prefs() {
      return store.getUser(targetUserId);
    },
    xp() {
      return readXp(backend, targetUserId);
    },
    rank() {
      return readRank(interaction, config, targetUserId);
    },
    cosmetics() {
      return readEquippedCosmetics(backend, targetUserId);
    },
    balances() {
      return readBalances(economy, targetUserId);
    }
  };
}

module.exports = {
  withTimeout,
  filterForViewer,
  balancesPermitted,
  assembleCardModel,
  readXp,
  readRank,
  readBalances,
  buildReaders
};

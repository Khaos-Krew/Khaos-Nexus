'use strict';

// Owner curve: level = floor(sqrt(xp / 100)) + 1, with no cap.
// Integer square root on integer XP so large totals never depend on float rounding.
// Level L starts at 100*(L-1)^2 XP. The next level is 100*L^2.
// Progress within the level is (xp - 100*(L-1)^2) / (100*(2L-1)).

const SAFE = BigInt(Number.MAX_SAFE_INTEGER);

function isqrt(value) {
  let n = value;
  if (n < 0n) return 0n;
  if (n < 2n) return n;
  let x = n;
  let y = (x + 1n) / 2n;
  while (y < x) {
    x = y;
    y = (x + n / x) / 2n;
  }
  return x;
}

function normalizeXp(value) {
  if (typeof value === 'bigint') return value > 0n ? value : 0n;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value <= 0) return 0n;
    if (Number.isSafeInteger(value)) return BigInt(value);
    const floored = Math.floor(value);
    if (!Number.isFinite(floored) || floored <= 0) return 0n;
    if (Number.isSafeInteger(floored)) return BigInt(floored);
    return 0n;
  }
  if (typeof value === 'string') {
    const text = value.trim();
    if (!/^\d+$/.test(text)) return 0n;
    try { return BigInt(text); } catch { return 0n; }
  }
  return 0n;
}

function present(value) {
  if (value <= SAFE) return Number(value);
  return value.toString();
}

function levelFromXp(xp) {
  const total = normalizeXp(xp);
  const level = isqrt(total / 100n) + 1n;
  const levelStartXp = 100n * (level - 1n) * (level - 1n);
  const nextLevelXp = 100n * level * level;
  const progressNeeded = 100n * (2n * level - 1n);
  const progressXp = total - levelStartXp;
  const progressPercent = progressNeeded === 0n ? 0 : Number((progressXp * 100n) / progressNeeded);
  return {
    xp: present(total),
    level: present(level),
    levelStartXp: present(levelStartXp),
    nextLevelXp: present(nextLevelXp),
    progressXp: present(progressXp),
    progressNeeded: present(progressNeeded),
    progressPercent: Math.max(0, Math.min(100, progressPercent))
  };
}

module.exports = {
  isqrt,
  normalizeXp,
  levelFromXp
};

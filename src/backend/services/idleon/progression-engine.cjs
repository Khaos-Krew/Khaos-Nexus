'use strict';

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));

const SYSTEM_RULES = {
  stamps: { label: 'Stamps', minWorld: 1, accountWide: 5, unlock: 4, ease: 4, hours: 0.35, action: 'Buy the cheapest high-value stamp levels you can currently afford.' },
  alchemy: { label: 'Alchemy', minWorld: 2, accountWide: 5, unlock: 5, ease: 3, hours: 1.0, action: 'Push bubbles, vials, liquid capacity and cauldrons before raw character damage.' },
  refinery: { label: 'Refinery', minWorld: 3, accountWide: 5, unlock: 5, ease: 3, hours: 0.5, action: 'Fix salt production ratios and prevent higher salts from starving lower-tier salts.' },
  construction: { label: 'Construction', minWorld: 3, accountWide: 5, unlock: 5, ease: 3, hours: 1.5, action: 'Prioritize build-rate, key buildings and tower levels that unlock account-wide progression.' },
  printer: { label: '3D Printer', minWorld: 3, accountWide: 5, unlock: 5, ease: 3, hours: 0.75, action: 'Resample the most valuable materials on the correct characters with sampling gear/cards.' },
  worship: { label: 'Worship', minWorld: 3, accountWide: 4, unlock: 4, ease: 4, hours: 0.25, action: 'Spend charge, improve skulls and push tower defense waves needed for souls and prayers.' },
  trapping: { label: 'Trapping', minWorld: 3, accountWide: 4, unlock: 4, ease: 4, hours: 0.25, action: 'Refresh traps with better boxes, durations and target critters.' },
  cooking: { label: 'Cooking', minWorld: 4, accountWide: 5, unlock: 5, ease: 3, hours: 1.0, action: 'Unlock meals and push low-cost meal levels before expensive single-meal grinds.' },
  breeding: { label: 'Breeding', minWorld: 4, accountWide: 4, unlock: 5, ease: 2, hours: 2.0, action: 'Push pet power, territory and arena breakpoints that unlock cooking multipliers.' },
  lab: { label: 'Laboratory', minWorld: 4, accountWide: 5, unlock: 5, ease: 3, hours: 0.75, action: 'Keep enough characters connected for key lab bonuses while minimizing overstaffing.' },
  divinity: { label: 'Divinity', minWorld: 5, accountWide: 5, unlock: 5, ease: 3, hours: 1.0, action: 'Unlock and equip gods that improve account-wide AFK, lab and skilling progression.' },
  sailing: { label: 'Sailing', minWorld: 5, accountWide: 5, unlock: 5, ease: 3, hours: 0.5, action: 'Collect loot, upgrade boats and target artifacts with the highest account-wide value.' },
  gaming: { label: 'Gaming', minWorld: 5, accountWide: 4, unlock: 4, ease: 4, hours: 0.25, action: 'Collect gains and prioritize upgrades that multiply future gaming growth.' },
  sneaking: { label: 'Sneaking', minWorld: 6, accountWide: 4, unlock: 4, ease: 3, hours: 0.5, action: 'Keep all available characters progressing with appropriate items and floor targets.' },
  farming: { label: 'Farming', minWorld: 6, accountWide: 4, unlock: 4, ease: 3, hours: 0.5, action: 'Harvest on schedule and prioritize crop unlocks/upgrades that compound future gains.' },
  summoning: { label: 'Summoning', minWorld: 6, accountWide: 4, unlock: 5, ease: 2, hours: 1.5, action: 'Push match breakpoints and upgrade slime stats where a win unlocks a major multiplier.' },
  cards: { label: 'Cards', minWorld: 1, accountWide: 3, unlock: 3, ease: 4, hours: 0.25, action: 'Equip card sets for the activity you are actively pushing rather than a generic damage set.' },
  obols: { label: 'Obols', minWorld: 2, accountWide: 3, unlock: 3, ease: 4, hours: 0.25, action: 'Fill empty slots first, then improve family/player obols around your current progression goal.' },
  gear: { label: 'Gear & Tools', minWorld: 1, accountWide: 3, unlock: 4, ease: 3, hours: 1.0, action: 'Upgrade outdated weapons, armor and tools only where they unlock a meaningful breakpoint.' },
  talents: { label: 'Talents', minWorld: 1, accountWide: 3, unlock: 3, ease: 5, hours: 0.1, action: 'Fix active/skilling presets and max the talents that directly multiply your current goal.' }
};

function normalizeProgress(value) {
  if (typeof value === 'number') return clamp(value > 1 ? value / 100 : value, 0, 1);
  if (!value || typeof value !== 'object') return 0;
  if (Number.isFinite(value.progress)) return normalizeProgress(value.progress);
  if (Number.isFinite(value.score)) return normalizeProgress(value.score);
  if (Number.isFinite(value.current) && Number.isFinite(value.target) && value.target > 0) return clamp(value.current / value.target, 0, 1);
  return 0;
}

function normalizeWorld(snapshot = {}) {
  const raw = snapshot.world ?? snapshot.meta?.world ?? snapshot.progress?.world ?? 1;
  const parsed = Number(String(raw).replace(/[^0-9.]/g, ''));
  return clamp(parsed || 1, 1, 99);
}

function scoreSystem(id, raw, snapshot) {
  const rule = SYSTEM_RULES[id];
  if (!rule) return null;
  const world = normalizeWorld(snapshot);
  if (world < rule.minWorld) return null;
  const value = raw && typeof raw === 'object' ? raw : { progress: raw };
  if (value.ignore === true || value.enabled === false) return null;
  const progress = normalizeProgress(value);
  const deficiency = clamp(1 - progress, 0, 1);
  const accountWide = clamp(value.accountWide ?? rule.accountWide, 1, 5);
  const unlock = clamp(value.unlockImportance ?? value.unlock ?? rule.unlock, 1, 5);
  const ease = clamp(value.ease ?? rule.ease, 1, 5);
  const hours = clamp(value.timeHours ?? value.hours ?? rule.hours, 0.05, 999);
  const readiness = value.ready === false ? 0.35 : clamp(value.readiness ?? 1, 0.1, 1);
  const rawScore = accountWide * unlock * (0.15 + deficiency) * ease * readiness / Math.sqrt(Math.max(hours, 0.25));
  return {
    id,
    system: rule.label,
    progress: Math.round(progress * 100),
    deficiency: Number(deficiency.toFixed(3)),
    score: Number(rawScore.toFixed(2)),
    accountWide,
    unlockImportance: unlock,
    ease,
    timeHours: hours,
    readiness,
    character: value.character || null,
    action: value.action || rule.action,
    reason: value.reason || `${rule.label} is at roughly ${Math.round(progress * 100)}% of the supplied target state.`,
    routine: value.routine || null,
    notes: value.notes || null
  };
}

function categoryFor(item, maxScore) {
  const relative = maxScore > 0 ? item.score / maxScore : 0;
  if (item.timeHours <= 0.25 && relative >= 0.35) return 'quick-win';
  if (relative >= 0.82) return 'critical';
  if (relative >= 0.55) return 'major';
  if (relative >= 0.30) return 'worth-doing';
  if (item.readiness < 0.6) return 'passive';
  return 'later';
}

function explicitSignals(snapshot = {}) {
  if (!Array.isArray(snapshot.signals)) return [];
  return snapshot.signals.map((signal, index) => {
    const progress = normalizeProgress(signal);
    const deficiency = clamp(1 - progress, 0, 1);
    const accountWide = clamp(signal.accountWide ?? 3, 1, 5);
    const unlock = clamp(signal.unlockImportance ?? signal.unlock ?? 3, 1, 5);
    const ease = clamp(signal.ease ?? 3, 1, 5);
    const hours = clamp(signal.timeHours ?? signal.hours ?? 0.5, 0.05, 999);
    const readiness = signal.ready === false ? 0.35 : clamp(signal.readiness ?? 1, 0.1, 1);
    const score = accountWide * unlock * (0.15 + deficiency) * ease * readiness / Math.sqrt(Math.max(hours, 0.25));
    return {
      id: signal.id || `signal-${index + 1}`,
      system: signal.system || 'Account',
      progress: Math.round(progress * 100),
      deficiency: Number(deficiency.toFixed(3)),
      score: Number(score.toFixed(2)),
      accountWide,
      unlockImportance: unlock,
      ease,
      timeHours: hours,
      readiness,
      character: signal.character || null,
      action: signal.action || signal.title || 'Complete this account upgrade.',
      reason: signal.reason || 'This item is behind the supplied target and has favorable progression value.',
      routine: signal.routine || null,
      notes: signal.notes || null
    };
  });
}

function buildReview(snapshot = {}, options = {}) {
  const systems = snapshot.systems && typeof snapshot.systems === 'object' ? snapshot.systems : {};
  const inferred = Object.entries(systems).map(([id, value]) => scoreSystem(id, value, snapshot)).filter(Boolean);
  const explicit = explicitSignals(snapshot);
  const all = [...explicit, ...inferred].filter((item) => item.score > 0).sort((a, b) => b.score - a.score);
  const maxScore = all[0]?.score || 0;
  const recommendations = all.map((item) => ({ ...item, category: categoryFor(item, maxScore) }));
  const limit = clamp(options.limit ?? 12, 1, 50);
  const top = recommendations.slice(0, limit);
  const quickWins = recommendations.filter((item) => item.category === 'quick-win').slice(0, 8);
  const now = recommendations.filter((item) => ['critical', 'major', 'quick-win'].includes(item.category)).slice(0, 5);
  return {
    generatedAt: new Date().toISOString(),
    account: snapshot.meta?.accountName || snapshot.accountName || null,
    source: snapshot.meta?.source || snapshot.source || 'manual-snapshot',
    world: normalizeWorld(snapshot),
    healthScore: recommendations.length ? Math.round(recommendations.reduce((sum, item) => sum + item.progress, 0) / recommendations.length) : null,
    topPriority: recommendations[0] || null,
    doNow: now,
    quickWins,
    recommendations: top,
    ignoredUnknownSystems: Object.keys(systems).filter((id) => !SYSTEM_RULES[id])
  };
}

module.exports = { SYSTEM_RULES, normalizeProgress, normalizeWorld, scoreSystem, buildReview };

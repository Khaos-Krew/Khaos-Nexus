'use strict';
const crypto = require('node:crypto');
const { CONFIG: BASE, deterministicRng } = require('./ark-dino-cache-engine.cjs');
const WEEK = 7 * 86400000;
// Explicit ASA Island allowlist; no DLC/mod creature is implicitly approved.
const APPROVED = new Set(['Parasaur','Moschops','Carbonemys','Trike','Pteranodon','Raptor','Carnotaurus','Dire Bear','Therizinosaur','Thylacoleo','Sarco','Beelzebufo','Kaprosuchus','Baryonyx','Ankylosaurus','Doedicurus','Sabertooth','Argentavis','Allosaurus','Rex','Yutyrannus']);
function weekStart(now = Date.now()) {
  const d = new Date(now); d.setUTCHours(0,0,0,0); d.setUTCDate(d.getUTCDate() - (d.getUTCDay()+6)%7); return d.getTime();
}
function allowed(entry) {
  const known=Object.values(BASE.groups).flat().find(e=>e.name===entry.name);
  return APPROVED.has(entry.name) && known?.blueprint===entry.blueprint && JSON.stringify(known.variants)===JSON.stringify(entry.variants) && !/moros|indomitable|indominus|indoraptor|shiny/i.test(JSON.stringify(entry)) && entry.blueprint.startsWith('/Game/PrimalEarth/');
}
function generateRotation(now, secret, previous = []) {
  const startsAt = weekStart(now), rng = deterministicRng(secret, `weekly-cache:${startsAt}`);
  const seen = new Set(), old = new Set(previous.map(e=>e.name));
  const candidates = Object.values(BASE.groups).flat().filter(e=>allowed(e) && !seen.has(e.name) && seen.add(e.name));
  const sorted = candidates.map(entry=>({ entry, score:rng(), old:old.has(entry.name) })).sort((a,b)=>Number(a.old)-Number(b.old)||a.score-b.score);
  if (sorted.length < 8) throw new Error('Weekly cache needs eight approved ASA creatures.');
  return { id:String(startsAt), startsAt, endsAt:startsAt+WEEK, cache:{ price:2500, cooldownMinutes:5, cooldownHours:1/12,
    displayName:'Weekly Featured Cache', emoji:'🗓️', tagline:'Eight approved ASA creatures. A new lineup every Monday at 00:00 UTC.',
    entries:sorted.slice(0,8).map(x=>x.entry), variantWeights:BASE.variantWeights, rarityWeights:{ common:35, uncommon:35, rare:25, ultra:5 },
    rotationId:String(startsAt), resetsAt:startsAt+WEEK, maps:['*'], groups:[], itemAliases:[] } };
}
let current = null;
let arnPolicy = { enabled:false, cache_cost:null };
function setArnPolicy(policy) { arnPolicy=policy; }
const CONFIG = { ...BASE, get caches() { return { ...BASE.caches, ...(current ? { weekly:current.cache } : {}), arn:{ ...BASE.caches.forest, entries:BASE.caches.forest.entries.filter(allowed), currency:'ARN_TOKENS', enabled:Boolean(arnPolicy.enabled), price:Number(arnPolicy.cache_cost)||0, displayName:'ARN Cache', emoji:'🎟️', tagline:'Spend ARN Tokens earned through verified Anomaly participation. Earning and redemption remain disabled until staff set rates.' } }; } };
async function ensureWeeklySchema(db) {
  await db.query(`CREATE TABLE IF NOT EXISTS nexus_weekly_cache_rotations (id VARCHAR(32) PRIMARY KEY, starts_at BIGINT NOT NULL, ends_at BIGINT NOT NULL, snapshot LONGTEXT NOT NULL, digest CHAR(64) NOT NULL, announced_at DATETIME(3) NULL, created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)) ENGINE=InnoDB`);
}
function validateSnapshot(row) {
  if (crypto.createHash('sha256').update(row.snapshot).digest('hex') !== row.digest) throw new Error('Weekly rotation integrity check failed.');
  const value = JSON.parse(row.snapshot);
  if (value.id !== String(row.id) || value.cache.entries.length !== 8 || value.cache.entries.some(e=>!allowed(e))) throw new Error('Weekly rotation contains an unapproved reward.');
  return value;
}
async function loadWeekly(db, secret, now = Date.now()) {
  await ensureWeeklySchema(db);
  const key = String(weekStart(now));
  let [rows] = await db.execute('SELECT * FROM nexus_weekly_cache_rotations WHERE id=?', [key]);
  if (!rows.length) {
    const [history] = await db.query('SELECT * FROM nexus_weekly_cache_rotations ORDER BY starts_at DESC LIMIT 1');
    const previous = history[0] ? validateSnapshot(history[0]).cache.entries : [];
    const next = generateRotation(now, secret, previous), snapshot = JSON.stringify(next);
    await db.execute('INSERT IGNORE INTO nexus_weekly_cache_rotations (id, starts_at, ends_at, snapshot, digest) VALUES (?, ?, ?, ?, ?)', [key,next.startsAt,next.endsAt,snapshot,crypto.createHash('sha256').update(snapshot).digest('hex')]);
    [rows] = await db.execute('SELECT * FROM nexus_weekly_cache_rotations WHERE id=?', [key]);
  }
  current = validateSnapshot(rows[0]);
  return { ...current, announcedAt:rows[0].announced_at };
}
module.exports = { CONFIG, APPROVED, WEEK, weekStart, allowed, generateRotation, ensureWeeklySchema, validateSnapshot, loadWeekly, setArnPolicy };

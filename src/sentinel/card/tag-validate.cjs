'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TAG_CAP = 12;
const CATALOG_PATH = path.join(__dirname, 'games.catalog.json');
const PLATFORM_PATH = path.join(__dirname, 'platforms.catalog.json');
const POLICY_PATH = path.join(__dirname, 'tag-policy.json');

const LEET = Object.freeze({
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  '$': 's'
});

const CONFUSABLES = Object.freeze({
  '\u0430': 'a',
  '\u03b1': 'a',
  '\u0435': 'e',
  '\u03b5': 'e',
  '\u0454': 'e',
  '\u043e': 'o',
  '\u03bf': 'o',
  '\u0440': 'p',
  '\u03c1': 'p',
  '\u0441': 'c',
  '\u03f2': 'c',
  '\u0445': 'x',
  '\u03c7': 'x',
  '\u0443': 'y',
  '\u0456': 'i',
  '\u03b9': 'i',
  '\u04cf': 'i',
  '\u0455': 's',
  '\u0442': 't',
  '\u04bb': 'h',
  '\u0501': 'd',
  '\u051b': 'q'
});

// Impersonation folds 1 to l so "Sentina1" matches "sentinal". The denylist
// leet map still folds 1 to i so "a.d.m.1.n" matches "admin".
const IMPERSONATION_DIGITS = Object.freeze({
  '0': 'o',
  '1': 'l',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't'
});

const RESERVED_FLOOR = Object.freeze([
  'admin',
  'staff',
  'mod',
  'bot',
  'mods',
  'moderator',
  'moderators',
  'official',
  'support',
  'sentinal',
  'sentinel',
  'nexus',
  'khaosnexus',
  'discord',
  'owner',
  'system',
  'gm',
  'verified',
  'cephalon',
  'ascended',
  'sanctuary',
  'vanguard'
]);

// Substring terms stay blocked inside a longer tag. Whole-word terms are
// matched on letter tokens after leading and trailing "x" padding is removed.
// Separators include digits, "_", ".", "-", and spaces. A digit-folded copy
// maps 1 to both i and l, and also keeps 1 as a separator so "M0d1" is "mod".
// "khaos" alone is not reserved. "nexus" matches the letters-only tag or a
// camelCase segment, so "Nexus" and "nexus1" are blocked and "Nexus Raider"
// is not. A token, or the whole letters-only name, is blocked when it is two
// or more reserved or role words joined together.
const SUBSTRING_TERMS = new Set(['admin', 'moderator', 'sentinal', 'sentinel', 'khaosnexus']);
const WHOLE_WORD_TERMS = new Set([
  'support', 'staff', 'official', 'system', 'verified', 'nexus', 'gm', 'discord',
  'mod', 'bot', 'owner'
]);
const COMPOUND_PARTS = Object.freeze([
  'account', 'admin', 'bot', 'crew', 'discord', 'gm', 'khaosnexus', 'member',
  'mod', 'moderator', 'mods', 'nexus', 'official', 'owner', 'sentinal', 'sentinel',
  'staff', 'support', 'system', 'team', 'verified'
].sort((left, right) => right.length - left.length));

let catalogCache = null;
let platformCache = null;
let policyCache = null;

function loadCatalog(file = CATALOG_PATH) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('Game catalog must be a non-empty array.');
  return parsed.map((entry) => Object.freeze({ ...entry }));
}

function catalog(file) {
  if (!file && catalogCache) return catalogCache;
  const loaded = loadCatalog(file || CATALOG_PATH);
  if (!file) catalogCache = loaded;
  return loaded;
}

function loadPolicy(file = POLICY_PATH) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    slurs: [...(parsed.slurs || [])],
    mild: [...(parsed.mild || [])],
    impersonation: [...(parsed.impersonation || [])],
    staffNames: [...(parsed.staffNames || [])]
  };
}

function policy(file) {
  if (!file && policyCache) return policyCache;
  const loaded = loadPolicy(file || POLICY_PATH);
  if (!file) policyCache = loaded;
  return loaded;
}

function gameById(gameId, games = catalog()) {
  return games.find((entry) => entry.id === String(gameId || '')) || null;
}

function loadPlatforms(file = PLATFORM_PATH) {
  const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (!Array.isArray(parsed) || !parsed.length) throw new Error('Platform catalog must be a non-empty array.');
  return parsed.map((entry) => Object.freeze({ ...entry }));
}

function platformCatalog(file) {
  if (!file && platformCache) return platformCache;
  const loaded = loadPlatforms(file || PLATFORM_PATH);
  if (!file) platformCache = loaded;
  return loaded;
}

function platformById(platformId, platforms = platformCatalog()) {
  return platforms.find((entry) => entry.id === String(platformId || '')) || null;
}

function suggestFrom(entries, query) {
  const needle = String(query || '').trim().toLowerCase();
  const matches = entries.filter((entry) => {
    if (!needle) return true;
    if (String(entry.label || '').toLowerCase().includes(needle)) return true;
    if (String(entry.id || '').toLowerCase().includes(needle)) return true;
    return (entry.aliases || []).some((alias) => String(alias).toLowerCase().includes(needle));
  });
  return matches.slice(0, 25).map((entry) => ({ name: entry.label, value: entry.id }));
}

function suggestGames(query, games = catalog()) {
  return suggestFrom(games, query);
}

function suggestPlatforms(query, platforms = platformCatalog()) {
  return suggestFrom(platforms, query);
}

function forbiddenChar(value) {
  if (/\p{Cc}/u.test(value)) return true;
  if (/\p{Cf}/u.test(value)) return true;
  if (/\p{Co}/u.test(value)) return true;
  if (/[\uFE00-\uFE0F]/u.test(value)) return true;
  if (/[\u{E0100}-\u{E01EF}]/u.test(value)) return true;
  if (/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/u.test(value)) return true;
  return false;
}

function combiningFlood(value) {
  let run = 0;
  for (const char of value) {
    if (/\p{M}/u.test(char)) {
      run += 1;
      if (run > 2) return true;
    } else {
      run = 0;
    }
  }
  return false;
}

function hasMention(value) {
  if (/@(everyone|here)/i.test(value)) return true;
  if (/<@[!&]?\d+>/.test(value)) return true;
  if (/<#\d+>/.test(value)) return true;
  return false;
}

function hasUrl(value) {
  const lower = value.toLowerCase();
  if (lower.includes('://')) return true;
  if (lower.includes('www.')) return true;
  if (lower.includes('discord.gg')) return true;
  if (lower.includes('discord.com/invite') || lower.includes('discordapp.com/invite')) return true;
  if (/[a-z0-9-]{1,63}\.[a-z]{2,24}\//i.test(lower)) return true;
  return false;
}

function hasMarkdown(value) {
  if (value.includes('`')) return true;
  if (value.includes('*')) return true;
  if (/_{2,}/.test(value)) return true;
  if (value.includes('|') || value.includes('~') || value.includes('>')) return true;
  if (/[\[\]()]/.test(value)) return true;
  return false;
}

function foldConfusables(value) {
  let out = '';
  for (const char of value) out += CONFUSABLES[char] || char;
  return out;
}

function foldLeet(value) {
  let out = '';
  for (const char of value.toLowerCase()) out += LEET[char] || char;
  return out;
}

function foldImpersonationDigits(value) {
  let out = '';
  for (const char of value) out += IMPERSONATION_DIGITS[char] || char;
  return out;
}

function stripSeparators(value) {
  return value.replace(/[\s._\-'#*|+~\\/]+/g, '');
}

function tokensOf(value) {
  return value.split(/[\s._\-'#*|+~\\/]+/).filter(Boolean);
}

function foldedForms(value) {
  const folded = foldLeet(foldConfusables(String(value || '').toLowerCase()));
  return {
    folded,
    stripped: stripSeparators(folded),
    tokens: tokensOf(folded)
  };
}

function phraseHit(forms, phrase) {
  const parts = String(phrase || '').trim().toLowerCase().split(/\s+/).filter(Boolean).map((part) => stripSeparators(foldLeet(foldConfusables(part))));
  if (!parts.length) return false;
  if (parts.length === 1) {
    const word = parts[0];
    return forms.stripped === word || forms.tokens.includes(word);
  }
  return forms.stripped.includes(parts.join(''));
}

function lettersOnly(value) {
  return String(value || '').replace(/[^\p{L}]+/gu, '');
}

function digitFoldVariants(text) {
  const chars = [...text];
  const ones = [];
  chars.forEach((char, index) => { if (char === '1') ones.push(index); });
  const fixed = { '0': 'o', '3': 'e', '4': 'a', '5': 's', '7': 't' };
  const width = Math.min(ones.length, 8);
  const variants = [];
  const count = width === 0 ? 1 : (1 << width);
  for (let mask = 0; mask < count; mask += 1) {
    let out = '';
    let oneIndex = 0;
    for (const char of chars) {
      if (char === '1') {
        const bit = oneIndex < width ? (mask >> oneIndex) & 1 : 0;
        oneIndex += 1;
        out += bit ? 'l' : 'i';
      } else {
        out += fixed[char] || char;
      }
    }
    variants.push(out);
  }
  // Keep 1 as a separator while folding the other leet digits. "M0d1" then
  // tokenizes as "mod" instead of "modi" or "modl".
  if (ones.length) {
    let separated = '';
    for (const char of chars) {
      if (char === '1') separated += ' ';
      else separated += fixed[char] || char;
    }
    variants.push(separated);
  }
  return variants;
}

function stripXPadding(token) {
  return String(token || '').replace(/^x+|x+$/g, '');
}

function wholeWordTokens(value) {
  return letterTokens(value).map(stripXPadding).filter(Boolean);
}

function collapseLetterTokens(tokens) {
  const collapsed = [];
  let run = '';
  for (const token of tokens) {
    if ([...token].length === 1) {
      run += token;
      continue;
    }
    if (run) collapsed.push(run);
    run = '';
    collapsed.push(token);
  }
  if (run) collapsed.push(run);
  return collapsed;
}

function letterTokens(value) {
  return collapseLetterTokens(String(value || '').split(/[^\p{L}]+/u).filter(Boolean));
}

function isReservedCompound(token) {
  if (!token || token.length < 4) return false;
  const memo = new Map();
  function canSplit(start, parts) {
    const capped = parts >= 2 ? 2 : parts;
    const key = `${start}:${capped}`;
    if (memo.has(key)) return memo.get(key);
    if (start === token.length) {
      const ok = parts >= 2;
      memo.set(key, ok);
      return ok;
    }
    let ok = false;
    for (const word of COMPOUND_PARTS) {
      if (token.startsWith(word, start) && canSplit(start + word.length, parts + 1)) {
        ok = true;
        break;
      }
    }
    memo.set(key, ok);
    return ok;
  }
  return canSplit(0, 0);
}

function impersonationKey(value) {
  let nfkc = String(value || '');
  try { nfkc = nfkc.normalize('NFKC'); } catch { /* keep the raw string */ }
  const folded = foldImpersonationDigits(foldConfusables(nfkc.toLowerCase()));
  const stripped = folded.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\s._\-'#*|+~\\/]+/g, '');
  const tokens = folded
    .split(/[\s._\-'#*|+~\\/]+/)
    .map((token) => token.replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, ''))
    .filter(Boolean);
  const camel = nfkc.replace(/(?<=\p{Ll})(?=\p{Lu})/gu, ' ');
  const surface = foldConfusables(camel.toLowerCase());
  const surfaces = [...new Set([surface, ...digitFoldVariants(surface)])];
  const letterTokenSets = surfaces.map(wholeWordTokens);
  const lettersOnlyTag = lettersOnly(surface);
  const lettersOnlyForms = surfaces.map((value) => stripXPadding(lettersOnly(value)));
  const camelLetters = nfkc.split(/(?<=\p{Ll})(?=\p{Lu})/gu).map((segment) => lettersOnly(foldConfusables(segment.toLowerCase())));
  return { stripped, tokens, letterTokenSets, lettersOnlyTag, lettersOnlyForms, camelLetters };
}

function wholeWordTermHit(key, needle) {
  if (needle === 'nexus') {
    if (key.lettersOnlyForms.some((form) => form === 'nexus')) return true;
    if (key.camelLetters.some((segment) => stripXPadding(segment) === 'nexus')) return true;
  } else if (key.letterTokenSets.some((tokens) => tokens.includes(needle))) {
    return true;
  }
  return key.letterTokenSets.some((tokens) => tokens.some((token) => isReservedCompound(token)))
    || key.lettersOnlyForms.some((form) => isReservedCompound(form));
}

function reservedTerms(rules) {
  return [...RESERVED_FLOOR, ...(rules?.impersonation || []), ...(rules?.staffNames || [])];
}

function reservedHit(key, phrase) {
  const needle = impersonationKey(phrase).stripped;
  if (!needle || needle === 'khaos') return false;
  if (SUBSTRING_TERMS.has(needle)) return key.stripped.includes(needle);
  if (WHOLE_WORD_TERMS.has(needle)) return wholeWordTermHit(key, needle);
  if (needle.length >= 4) return key.stripped.includes(needle);
  return key.stripped === needle || key.tokens.includes(needle);
}

function denylistReason(value, rules) {
  const forms = foldedForms(value);
  for (const slur of rules.slurs || []) {
    const needle = stripSeparators(foldLeet(foldConfusables(String(slur).toLowerCase())));
    if (!needle) continue;
    if (forms.folded.includes(needle) || forms.stripped.includes(needle)) return 'denylist';
  }
  for (const word of rules.mild || []) {
    if (phraseHit(forms, word)) return 'denylist';
  }
  return null;
}

function impersonationReason(value, rules) {
  const key = impersonationKey(value);
  for (const phrase of reservedTerms(rules)) {
    if (reservedHit(key, phrase)) return 'impersonation';
  }
  return null;
}

function steamProfileText(value) {
  const match = /^(?:https?:\/\/)?steamcommunity\.com\/(?:profiles\/(\d{17})|id\/([A-Za-z0-9_-]{2,32}))\/?$/i.exec(value);
  if (!match) return null;
  return match[1] || match[2];
}

function structuralReason(raw, { allowSteamProfile = false } = {}) {
  const original = String(raw ?? '');
  let nfkc;
  try { nfkc = original.normalize('NFKC'); } catch { return { ok: false, reason: 'forbidden-char' }; }
  if (forbiddenChar(original) || forbiddenChar(nfkc)) return { ok: false, reason: 'forbidden-char' };
  if (combiningFlood(original) || combiningFlood(nfkc)) return { ok: false, reason: 'combining' };
  if (nfkc.trim() === '') return { ok: false, reason: 'empty' };
  if (nfkc !== nfkc.trim() || /\s{2,}/.test(nfkc)) return { ok: false, reason: 'spacing' };
  if (hasMention(nfkc)) return { ok: false, reason: 'mention' };
  if (hasUrl(nfkc) && !(allowSteamProfile && steamProfileText(nfkc))) return { ok: false, reason: 'url' };
  if (hasMarkdown(nfkc)) return { ok: false, reason: 'markdown' };
  if (nfkc.startsWith('#')) return { ok: false, reason: 'leading-hash' };
  return { ok: true, value: nfkc };
}

function abuseReason(value, rules) {
  return denylistReason(value, rules) || impersonationReason(value, rules);
}

function acceptPattern(value, pattern) {
  if (!matchesPattern(value, pattern)) return { ok: false, reason: 'pattern' };
  return { ok: true, value };
}

function normalizeSteam(value) {
  const profile = steamProfileText(value);
  if (profile) return { ok: true, value: profile };
  if (/^\d{17}$/.test(value)) return { ok: true, value };
  return acceptPattern(value, '^[\\p{L}\\p{N}_.\'# -]{2,32}$');
}

function normalizeXbox(value) {
  const match = /^([\p{L}\p{N}](?:[\p{L}\p{N} ]{0,10}[\p{L}\p{N}])?)(?:#(\d{1,4}))?$/u.exec(value);
  if (!match) return { ok: false, reason: 'pattern' };
  const base = match[1];
  if (base.length > 12) return { ok: false, reason: 'pattern' };
  return { ok: true, value: match[2] ? `${base}#${match[2]}` : base };
}

function normalizeNintendo(value) {
  const friend = /^SW-(\d{4})-(\d{4})-(\d{4})$/i.exec(value);
  if (friend) return { ok: true, value: `SW-${friend[1]}-${friend[2]}-${friend[3]}` };
  if (/^SW[-\d]*$/i.test(value)) return { ok: false, reason: 'pattern' };
  const codeThenNick = /^(SW-\d{4}-\d{4}-\d{4})(\s*\/\s*)(.+)$/i.exec(value);
  if (codeThenNick) {
    const code = normalizeNintendo(codeThenNick[1]);
    const nick = acceptPattern(codeThenNick[3], '^[\\p{L}\\p{N}][\\p{L}\\p{N}_.\' -]{0,15}$');
    if (!code.ok || !nick.ok || nick.value.length > 16) return { ok: false, reason: 'pattern' };
    const joiner = /\s/.test(codeThenNick[2]) ? ' / ' : '/';
    return { ok: true, value: `${code.value}${joiner}${nick.value}` };
  }
  const both = /^(.+) (SW-\d{4}-\d{4}-\d{4})$/i.exec(value);
  if (both) {
    const nick = acceptPattern(both[1], '^[\\p{L}\\p{N}][\\p{L}\\p{N}_.\' -]{0,15}$');
    const code = normalizeNintendo(both[2]);
    if (!nick.ok || !code.ok || nick.value.length > 16) return { ok: false, reason: 'pattern' };
    return { ok: true, value: `${nick.value} ${code.value}` };
  }
  const nick = acceptPattern(value, '^[\\p{L}\\p{N}][\\p{L}\\p{N}_.\' -]{0,15}$');
  if (!nick.ok || nick.value.length > 16) return { ok: false, reason: 'pattern' };
  return nick;
}

function normalizeRiot(value) {
  const hash = value.lastIndexOf('#');
  if (hash <= 0) return { ok: false, reason: 'pattern' };
  const name = value.slice(0, hash);
  const tag = value.slice(hash + 1);
  if (!/^[\p{L}\p{N}]{3,5}$/u.test(tag)) return { ok: false, reason: 'pattern' };
  if (name.length < 3 || name.length > 16) return { ok: false, reason: 'pattern' };
  if (!/^[\p{L}\p{N}](?:[\p{L}\p{N} ]*[\p{L}\p{N}])?$/u.test(name)) return { ok: false, reason: 'pattern' };
  return { ok: true, value: `${name}#${tag}` };
}

function normalizePlatformValue(platformId, value) {
  if (platformId === 'steam') return normalizeSteam(value);
  if (platformId === 'xbox') return normalizeXbox(value);
  if (platformId === 'psn') return acceptPattern(value, '^[A-Za-z][A-Za-z0-9_-]{2,15}$');
  if (platformId === 'nintendo') return normalizeNintendo(value);
  if (platformId === 'epic') return acceptPattern(value, '^[\\p{L}\\p{N}_.\' -]{3,16}$');
  if (platformId === 'battlenet') return acceptPattern(value, '^[\\p{L}][\\p{L}\\p{N}]{2,11}#\\d{4,6}$');
  if (platformId === 'ea' || platformId === 'ubisoft') return acceptPattern(value, '^[A-Za-z0-9][A-Za-z0-9._-]{2,15}$');
  if (platformId === 'riot') return normalizeRiot(value);
  return { ok: false, reason: 'pattern' };
}

function validatePlatform({ platformId, tag, platforms = platformCatalog(), rules = policy() } = {}) {
  const entry = platformById(platformId, platforms);
  if (!entry) return { ok: false, reason: 'unknown-platform', platform: null };
  const ruleset = rules || policy();
  const structural = structuralReason(tag, { allowSteamProfile: entry.id === 'steam' });
  if (!structural.ok) return { ok: false, reason: structural.reason, platform: entry.id };
  const normalized = normalizePlatformValue(entry.id, structural.value);
  if (!normalized.ok) return { ok: false, reason: normalized.reason, platform: entry.id };
  const abuse = abuseReason(normalized.value, ruleset);
  if (abuse) return { ok: false, reason: abuse, platform: entry.id };
  return { ok: true, platform: entry.id, tag: normalized.value, verified: false };
}

function matchesPattern(value, pattern) {
  if (!pattern) return false;
  return new RegExp(pattern, 'u').test(value);
}

function screenText(raw, pattern, rules) {
  const structural = structuralReason(raw);
  if (!structural.ok) return structural;
  if (!matchesPattern(structural.value, pattern)) return { ok: false, reason: 'pattern' };
  const denied = denylistReason(structural.value, rules);
  if (denied) return { ok: false, reason: denied };
  const impersonated = impersonationReason(structural.value, rules);
  if (impersonated) return { ok: false, reason: impersonated };
  return { ok: true, value: structural.value };
}

function canAddTag(existingTags, gameId, cap = TAG_CAP) {
  const tags = existingTags && typeof existingTags === 'object' ? existingTags : {};
  if (Object.prototype.hasOwnProperty.call(tags, gameId)) return { ok: true, replacing: true };
  if (Object.keys(tags).length >= cap) return { ok: false, reason: 'tag-cap' };
  return { ok: true, replacing: false };
}

function validateTag({ gameId, tag, name = '', games = catalog(), rules = policy(), existingTags = null } = {}) {
  const entry = gameById(gameId, games);
  if (!entry) return { ok: false, reason: 'unknown-game', game: null };
  const ruleset = rules || policy();
  if (entry.id === 'other') {
    const gameName = screenText(name, entry.namePattern || entry.pattern, ruleset);
    if (!gameName.ok) return { ok: false, reason: `name-${gameName.reason}`, game: entry.id };
    const gamerTag = screenText(tag, entry.pattern, ruleset);
    if (!gamerTag.ok) return { ok: false, reason: gamerTag.reason, game: entry.id };
    if (existingTags) {
      const cap = canAddTag(existingTags, entry.id);
      if (!cap.ok) return { ok: false, reason: cap.reason, game: entry.id };
    }
    return { ok: true, game: entry.id, tag: gamerTag.value, name: gameName.value, verified: false };
  }
  const gamerTag = screenText(tag, entry.pattern, ruleset);
  if (!gamerTag.ok) return { ok: false, reason: gamerTag.reason, game: entry.id };
  if (existingTags) {
    const cap = canAddTag(existingTags, entry.id);
    if (!cap.ok) return { ok: false, reason: cap.reason, game: entry.id };
  }
  return { ok: true, game: entry.id, tag: gamerTag.value, verified: false };
}

module.exports = {
  TAG_CAP,
  CATALOG_PATH,
  PLATFORM_PATH,
  POLICY_PATH,
  loadCatalog,
  loadPolicy,
  catalog,
  platformCatalog,
  policy,
  gameById,
  platformById,
  suggestGames,
  suggestPlatforms,
  canAddTag,
  validateTag,
  validatePlatform,
  foldedForms
};

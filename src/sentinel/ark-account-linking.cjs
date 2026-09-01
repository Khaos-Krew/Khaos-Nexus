'use strict';

const crypto = require('node:crypto');
const { NEXUS_RANKS } = require('../shared/ranks.cjs');

function clean(value, max = 256) {
  return String(value || '').replace(/[\r\n\t\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function escaped(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function chatIdentity(value) {
  let before = clean(value, 240)
    .replace(/^\[[^\]]+\]\s*/, '')
    .replace(/^\d{4}\.\d{2}\.\d{2}[_ -]\d{2}\.\d{2}\.\d{2}(?::\d+)?\s*:\s*(?:Log[A-Za-z0-9_]+\s*:\s*)?/i, '')
    .replace(/^(?:global|local|tribe|alliance|server)(?:\s+chat)?\s*:\s*/i, '')
    .trim();
  const quotedCharacter = before.match(/^(.*?)\s*\("([^"]{1,80})"\)(?:\s*\[[^\]]{1,80}\])?$/);
  if (quotedCharacter) {
    return {
      playerName: clean(quotedCharacter[1], 80),
      characterName: clean(quotedCharacter[2], 80),
      eosId: ''
    };
  }
  const namedCharacter = before.match(/^(.*?)\s*\(([^)]{1,80})\)(?:\s*\[[^\]]{1,80}\])?$/);
  if (namedCharacter) {
    const parenthesized = clean(namedCharacter[2], 128);
    if (/^[A-Za-z0-9_-]{8,128}$/.test(parenthesized)) {
      return { playerName: clean(namedCharacter[1], 80), characterName: '', eosId: parenthesized };
    }
    return {
      playerName: clean(namedCharacter[1], 80),
      characterName: clean(namedCharacter[2], 80),
      eosId: ''
    };
  }
  const bracketed = before.match(/^(.*?)\s*\[([A-Za-z0-9_-]{8,128})\]$/);
  if (bracketed) return { playerName: clean(bracketed[1], 80), characterName: '', eosId: clean(bracketed[2], 128) };
  return { playerName: clean(before, 80), characterName: '', eosId: '' };
}

function parseArkChatLines(response = '', chatCommand = '!link') {
  const messages = [];
  const commandText = clean(chatCommand, 32) || '!link';
  const matcher = new RegExp(`${escaped(commandText)}\\s+([A-Z2-9]{6,12})\\b`, 'i');
  for (const raw of String(response || '').split(/\r?\n/)) {
    const line = clean(raw, 600);
    if (!line || !matcher.test(line)) continue;
    const command = line.match(matcher);
    const before = line.slice(0, command.index).replace(/[\s:>\-]+$/, '');
    const identity = chatIdentity(before);
    messages.push({ line, ...identity, code: command[1].toUpperCase() });
  }
  return messages;
}

function resolveChatIdentity(message = {}, onlinePlayers = []) {
  if (message.eosId) {
    const direct = onlinePlayers.find((player) => clean(player.eosId, 128) === message.eosId);
    return direct ? { ok: true, player: direct } : { ok: false, reason: 'claimed-eos-not-online' };
  }
  const wanted = new Set([message.playerName, message.characterName]
    .map((item) => clean(item, 80).toLocaleLowerCase())
    .filter(Boolean));
  const matches = onlinePlayers.filter((player) => wanted.has(clean(player.name, 80).toLocaleLowerCase()) && clean(player.eosId, 128));
  if (matches.length !== 1) return { ok: false, reason: matches.length ? 'ambiguous-player-name' : 'online-player-not-found' };
  return { ok: true, player: matches[0] };
}

function normalizedRankName(value) {
  return clean(value, 100).toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function highestConfiguredRankForMember(member, config = {}) {
  const roles = member?.roles?.cache;
  const roleValues = typeof roles?.values === 'function' ? [...roles.values()] : Array.isArray(roles) ? roles : [];
  let selected = NEXUS_RANKS[0];
  for (const rank of NEXUS_RANKS) {
    const roleId = clean(config?.discord?.rankRoles?.[rank.id], 32);
    const hasConfiguredRole = roleId && (typeof roles?.has === 'function' ? roles.has(roleId) : roleValues.some((role) => clean(role?.id || role, 32) === roleId));
    const hasNamedFallback = !roleId && roleValues.some((role) => normalizedRankName(role?.name) === normalizedRankName(rank.name));
    const hasRole = hasConfiguredRole || hasNamedFallback;
    if (hasRole && rank.level > selected.level) selected = rank;
  }
  return selected;
}

class ArkAccountLinkService {
  constructor({ store, maxSeen = 1000 } = {}) {
    if (!store) throw new Error('ArkAccountLinkService requires an identity store.');
    this.store = store;
    this.maxSeen = Math.max(100, Number(maxSeen) || 1000);
    this.seen = new Set();
  }

  consumeChat(response, { players = [], mapId = '', chatCommand = '!link' } = {}) {
    const results = [];
    for (const message of parseArkChatLines(response, chatCommand)) {
      const fingerprint = crypto.createHash('sha256').update(`${mapId}\n${message.line}`).digest('hex');
      if (this.seen.has(fingerprint)) continue;
      this.seen.add(fingerprint);
      while (this.seen.size > this.maxSeen) this.seen.delete(this.seen.values().next().value);
      const identity = resolveChatIdentity(message, players);
      if (!identity.ok) {
        results.push({ ok: false, reason: identity.reason, message });
        continue;
      }
      results.push({ ...this.store.verifyChallenge({ code: message.code, eosId: identity.player.eosId, playerName: identity.player.name, mapId }), message });
    }
    return results;
  }

  syncMemberRank(member, config = {}) {
    const discordUserId = clean(member?.id || member?.user?.id, 32);
    const rank = highestConfiguredRankForMember(member, config);
    return this.store.updateRank(discordUserId, rank.id);
  }
}

module.exports = { chatIdentity, parseArkChatLines, resolveChatIdentity, normalizedRankName, highestConfiguredRankForMember, ArkAccountLinkService };

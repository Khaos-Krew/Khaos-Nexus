'use strict';

const crypto = require('node:crypto');
const { NEXUS_RANKS } = require('../shared/ranks.cjs');

function clean(value, max = 256) {
  return String(value || '').replace(/[\r\n\t\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function parseArkChatLines(response = '') {
  const messages = [];
  for (const raw of String(response || '').split(/\r?\n/)) {
    const line = clean(raw, 600);
    if (!line || !/!link\s+[A-Z2-9]{6,12}\b/i.test(line)) continue;
    const command = line.match(/!link\s+([A-Z2-9]{6,12})\b/i);
    const before = line.slice(0, command.index).replace(/^\[[^\]]+\]\s*/, '').replace(/[\s:>\-]+$/, '');
    let playerName = before;
    let eosId = '';
    const bracketed = before.match(/^(.*?)\s*[\[(]([A-Za-z0-9_-]{8,128})[\])]$/);
    if (bracketed) {
      playerName = clean(bracketed[1], 80);
      eosId = clean(bracketed[2], 128);
    }
    messages.push({ line, playerName: clean(playerName, 80), eosId, code: command[1].toUpperCase() });
  }
  return messages;
}

function resolveChatIdentity(message = {}, onlinePlayers = []) {
  if (message.eosId) {
    const direct = onlinePlayers.find((player) => clean(player.eosId, 128) === message.eosId);
    return direct ? { ok: true, player: direct } : { ok: false, reason: 'claimed-eos-not-online' };
  }
  const wanted = clean(message.playerName, 80).toLocaleLowerCase();
  const matches = onlinePlayers.filter((player) => clean(player.name, 80).toLocaleLowerCase() === wanted && clean(player.eosId, 128));
  if (matches.length !== 1) return { ok: false, reason: matches.length ? 'ambiguous-player-name' : 'online-player-not-found' };
  return { ok: true, player: matches[0] };
}

function highestConfiguredRankForMember(member, config = {}) {
  const roles = member?.roles?.cache;
  let selected = NEXUS_RANKS[0];
  for (const rank of NEXUS_RANKS) {
    const roleId = clean(config?.discord?.rankRoles?.[rank.id], 32);
    const hasRole = roleId && (typeof roles?.has === 'function' ? roles.has(roleId) : Array.isArray(roles) && roles.some((role) => clean(role?.id || role, 32) === roleId));
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

  consumeChat(response, { players = [], mapId = '' } = {}) {
    const results = [];
    for (const message of parseArkChatLines(response)) {
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

module.exports = { parseArkChatLines, resolveChatIdentity, highestConfiguredRankForMember, ArkAccountLinkService };

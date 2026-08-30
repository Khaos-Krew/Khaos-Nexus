'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const LOOP_MARKER = '[NEXUS-XCHAT]';

function cleanMessage(value, max = 350) {
  return String(value || '')
    .replace(/[\r\n\t\u0000-\u001f\u007f]+/g, ' ')
    .replace(/@everyone|@here/gi, '@ community')
    .replace(/\s+/g, ' ').trim().slice(0, max);
}

function parseArkChat(response = '') {
  const messages = [];
  for (const raw of String(response || '').split(/\r?\n/)) {
    const line = cleanMessage(raw, 600);
    const match = line.match(/^(?:\[[^\]]+\]\s*)?(.{1,80}?)\s*(?:\(([A-Za-z0-9_-]{8,128})\))?\s*:\s*(.{1,450})$/);
    if (!match) continue;
    const message = cleanMessage(match[3]);
    if (!message || message.includes(LOOP_MARKER) || /^!link\s+/i.test(message)) continue;
    messages.push({ playerName: cleanMessage(match[1], 80), eosId: cleanMessage(match[2], 128), message, raw: line });
  }
  return messages;
}

class SlidingWindowLimiter {
  constructor({ limit = 5, windowMs = 10_000, now = Date.now } = {}) {
    this.limit = Math.max(1, Number(limit) || 5);
    this.windowMs = Math.max(1000, Number(windowMs) || 10_000);
    this.now = now;
    this.entries = new Map();
  }

  allow(key) {
    const now = this.now();
    const recent = (this.entries.get(key) || []).filter((time) => now - time < this.windowMs);
    if (recent.length >= this.limit) {
      this.entries.set(key, recent);
      return false;
    }
    recent.push(now);
    this.entries.set(key, recent);
    return true;
  }
}

class CrossChatAuditJournal {
  constructor(root = process.env.NEXUS_DATA_DIR || path.resolve(__dirname, '../..', 'data')) {
    this.dir = path.resolve(root);
    this.file = path.join(this.dir, 'ark-cross-chat-audit.json');
  }

  read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return { version: 1, entries: Array.isArray(parsed?.entries) ? parsed.entries.slice(-10_000) : [] };
    } catch { return { version: 1, entries: [] }; }
  }

  record(entry = {}) {
    const state = this.read();
    const item = { id: crypto.randomUUID(), at: new Date().toISOString(), ...entry };
    state.entries.push(item);
    fs.mkdirSync(this.dir, { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ version: 1, updatedAt: item.at, entries: state.entries.slice(-10_000) }, null, 2));
    fs.renameSync(tmp, this.file);
    return item;
  }
}

class ArkCrossChatRouter {
  constructor(options = {}) {
    this.journal = options.journal || new CrossChatAuditJournal(options.root);
    this.moderate = typeof options.moderate === 'function' ? options.moderate : () => ({ allowed: true });
    this.limiter = options.limiter || new SlidingWindowLimiter(options.rateLimit);
    this.seen = new Set(this.journal.read().entries.map((entry) => entry.fingerprint).filter(Boolean).slice(-2000));
  }

  acceptArk(message, { mapId = 'ARK', identity = null } = {}) {
    const fingerprint = crypto.createHash('sha256').update(`${mapId}\n${message.raw || `${message.playerName}:${message.message}`}`).digest('hex');
    if (this.seen.has(fingerprint)) return { ok: false, reason: 'loop-or-replay' };
    this.seen.add(fingerprint);
    while (this.seen.size > 2000) this.seen.delete(this.seen.values().next().value);
    const actor = String(message.eosId || message.playerName || 'unknown');
    if (!this.limiter.allow(`ark:${actor}`)) return this.block('ark-to-discord', mapId, actor, 'rate-limited', message.message);
    const moderation = this.moderate({ direction: 'ark-to-discord', mapId, actor, message: message.message }) || {};
    if (moderation.allowed === false) return this.block('ark-to-discord', mapId, actor, moderation.reason || 'moderated', message.message);
    const display = cleanMessage(identity?.discordDisplayName || message.playerName || 'ARK Survivor', 80);
    const content = `**NEXUS • ${cleanMessage(mapId, 40)}** — **${display}**: ${cleanMessage(message.message)}`;
    this.journal.record({ direction: 'ark-to-discord', mapId, actor, outcome: 'relayed', fingerprint, contentHash: this.hash(message.message) });
    return { ok: true, content, allowedMentions: { parse: [] } };
  }

  acceptDiscord(message, { mapId = 'ARK' } = {}) {
    const actor = String(message.authorId || 'unknown');
    const body = cleanMessage(message.message);
    if (!body) return { ok: false, reason: 'empty-message' };
    if (!this.limiter.allow(`discord:${actor}`)) return this.block('discord-to-ark', mapId, actor, 'rate-limited', body);
    const moderation = this.moderate({ direction: 'discord-to-ark', mapId, actor, message: body }) || {};
    if (moderation.allowed === false) return this.block('discord-to-ark', mapId, actor, moderation.reason || 'moderated', body);
    const display = cleanMessage(message.displayName || 'Discord', 50);
    const relay = `${LOOP_MARKER} [Discord] ${display}: ${body}`;
    this.journal.record({ direction: 'discord-to-ark', mapId, actor, outcome: 'relayed', contentHash: this.hash(body) });
    return { ok: true, relay };
  }

  hash(value) { return crypto.createHash('sha256').update(String(value || '')).digest('hex'); }

  block(direction, mapId, actor, reason, message) {
    this.journal.record({ direction, mapId, actor, outcome: 'blocked', reason, contentHash: this.hash(message) });
    return { ok: false, reason };
  }
}

module.exports = { LOOP_MARKER, cleanMessage, parseArkChat, SlidingWindowLimiter, CrossChatAuditJournal, ArkCrossChatRouter };

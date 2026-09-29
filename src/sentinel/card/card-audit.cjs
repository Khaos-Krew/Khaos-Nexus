'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Mutex } = require('./card-store.cjs');

const USER_RETENTION_DAYS = 90;
const ADMIN_RETENTION_DAYS = 365;
const LOOKUP_DETAIL_DAYS = 30;
const ADMIN_ACTION = 'admin-clear';
const ADMIN_FIND_ACTION = 'admin-find';
const LOOKUP_ACTION = 'lookup';
const LONG_LIVED_ACTIONS = new Set([ADMIN_ACTION, ADMIN_FIND_ACTION]);

function redactLookup(row) {
  return {
    at: row.at,
    action: LOOKUP_ACTION,
    game: row.game ?? null,
    guildId: row.guildId ?? null,
    hit: row.hit === true,
    hitCount: Number.isFinite(Number(row.hitCount)) ? Number(row.hitCount) : 0
  };
}

function dayStamp(date) {
  return new Date(date).toISOString().slice(0, 10);
}

function parseLine(line) {
  try {
    const parsed = JSON.parse(line);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

class CardAuditLog {
  constructor(dir, options = {}) {
    this.dir = path.resolve(dir);
    this.now = typeof options.now === 'function' ? options.now : () => new Date();
    this.mutex = new Mutex();
    this.timer = null;
    fs.mkdirSync(this.dir, { recursive: true });
    this.prune(this.now());
  }

  fileFor(date) {
    return path.join(this.dir, `card-${dayStamp(date)}.jsonl`);
  }

  async append(row) {
    const record = { ...row };
    if (!record.at) record.at = new Date(this.now()).toISOString();
    return this.mutex.run(() => {
      fs.mkdirSync(this.dir, { recursive: true });
      fs.appendFileSync(this.fileFor(record.at), `${JSON.stringify(record)}\n`, { mode: 0o600 });
      return record;
    });
  }

  async reject({ game = null, reason, at = null } = {}) {
    const row = {
      at: at || new Date(this.now()).toISOString(),
      action: 'reject',
      game: game || null,
      reason: String(reason || 'reject')
    };
    return this.append(row);
  }

  prune(now = new Date()) {
    fs.mkdirSync(this.dir, { recursive: true });
    const today = Date.parse(`${dayStamp(now)}T00:00:00.000Z`);
    for (const name of fs.readdirSync(this.dir)) {
      const match = /^card-(\d{4}-\d{2}-\d{2})\.jsonl$/.exec(name);
      if (!match) continue;
      const fileDay = Date.parse(`${match[1]}T00:00:00.000Z`);
      if (!Number.isFinite(fileDay) || !Number.isFinite(today)) continue;
      const ageDays = Math.round((today - fileDay) / 86_400_000);
      const filePath = path.join(this.dir, name);
      const rows = fs.readFileSync(filePath, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map(parseLine)
        .filter(Boolean);
      if (ageDays >= ADMIN_RETENTION_DAYS) {
        fs.unlinkSync(filePath);
        continue;
      }
      if (ageDays >= USER_RETENTION_DAYS) {
        const kept = rows
          .filter((row) => LONG_LIVED_ACTIONS.has(row.action) || row.action === LOOKUP_ACTION)
          .map((row) => (row.action === LOOKUP_ACTION ? redactLookup(row) : row));
        if (!kept.length) {
          fs.unlinkSync(filePath);
          continue;
        }
        fs.writeFileSync(filePath, `${kept.map((row) => JSON.stringify(row)).join('\n')}\n`, { mode: 0o600 });
        continue;
      }
      if (ageDays < LOOKUP_DETAIL_DAYS) continue;
      let changed = false;
      const next = rows.map((row) => {
        if (row.action !== LOOKUP_ACTION) return row;
        const redacted = redactLookup(row);
        if (JSON.stringify(redacted) !== JSON.stringify(row)) changed = true;
        return redacted;
      });
      if (changed) fs.writeFileSync(filePath, `${next.map((row) => JSON.stringify(row)).join('\n')}\n`, { mode: 0o600 });
    }
  }

  scheduleDaily() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try { this.prune(this.now()); } catch (error) {
        console.error(`[Player Card] audit prune failed: ${String(error?.message || error).slice(0, 180)}`);
      }
    }, 86_400_000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

module.exports = {
  USER_RETENTION_DAYS,
  ADMIN_RETENTION_DAYS,
  LOOKUP_DETAIL_DAYS,
  ADMIN_ACTION,
  ADMIN_FIND_ACTION,
  LOOKUP_ACTION,
  redactLookup,
  dayStamp,
  CardAuditLog
};

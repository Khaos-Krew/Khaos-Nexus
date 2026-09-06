'use strict';
const crypto = require('node:crypto');
const { DEFINITIONS } = require('./definitions.cjs');
const { ProtocolStore } = require('./store.cjs');
function id(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/.test(value)) throw new Error('Invalid Protocol identifier');
  return value;
}
function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Expected an integer from ${min} to ${max}`);
  return value;
}
function requireRun(state, runId) {
  const run = state.runs.find((item) => item.id === id(runId));
  if (!run) throw new Error('Protocol run not found');
  return run;
}
class ProtocolEngine {
  constructor({ store = new ProtocolStore(), now = Date.now } = {}) { this.store = store; this.now = now; }
  season({ seasonId, startAt, endAt }, actor) {
    id(seasonId); integer(startAt, 0, Number.MAX_SAFE_INTEGER); integer(endAt, startAt + 1, Number.MAX_SAFE_INTEGER);
    return this.store.transact(actor, `season.create:${seasonId}`, (s) => {
      if (s.seasons.some((x) => x.id === seasonId || startAt < x.endAt && endAt > x.startAt)) throw new Error('Duplicate or overlapping season');
      const result = { id: seasonId, startAt, endAt }; s.seasons.push(result); return result;
    });
  }
  create({ type, maps, seasonId, minActiveSeconds = 300, target = 1, score = 100, durationSeconds = 3600 }, actor) {
    const definition = DEFINITIONS.find((x) => x.id === type);
    if (!definition) throw new Error('Unknown Protocol definition');
    if (!Array.isArray(maps) || !maps.length || maps.length > 20) throw new Error('Explicit map scope required');
    maps.forEach(id); id(seasonId);
    integer(minActiveSeconds, 0, 86400); integer(target, 1, 100000); integer(score, 0, 100000); integer(durationSeconds, Math.max(60, minActiveSeconds), 604800);
    return this.store.transact(actor, `run.create:${type}`, (s) => {
      if (!s.seasons.some((x) => x.id === seasonId)) throw new Error('Season not found');
      const run = { id: crypto.randomUUID(), definition: { ...definition }, maps: [...new Set(maps)], seasonId,
        rules: { minActiveSeconds, target, score, durationSeconds }, status: 'draft', createdAt: this.now(), participants: [] };
      s.runs.push(run); return run;
    });
  }
  transition(runId, next, actor) {
    return this.store.transact(actor, `run.${next}:${runId}`, (s) => {
      const run = requireRun(s, runId);
      const now = this.now();
      const transitions = { draft: ['active', 'cancelled'], active: ['paused', 'completed', 'failed', 'cancelled'], paused: ['active', 'failed', 'cancelled'] };
      if (!transitions[run.status]?.includes(next)) throw new Error('Invalid Protocol lifecycle transition');
      if (next === 'active') {
        if (run.definition.id === 'dark-zone') throw new Error('Dark Zone activation contained until a verified game protection adapter is installed');
        const season = s.seasons.find((x) => x.id === run.seasonId);
        if (now < season.startAt || now >= season.endAt) throw new Error('Season is not active');
        if (run.startedAt == null) { run.startedAt = now; run.endsAt = Math.min(now + run.rules.durationSeconds * 1000, season.endAt); }
        if (now >= run.endsAt) throw new Error('Run expired');
        // New activity samples must start after resuming, so paused time earns no credit.
        run.activeSince = now;
      }
      if (next === 'completed' && now > run.endsAt) throw new Error('Run expired; record failure or cancellation');
      run.status = next;
      if (['completed', 'failed', 'cancelled'].includes(next)) {
        run.endedAt = now;
        for (const p of run.participants) {
          p.qualified = next === 'completed' && !p.disqualified && p.activeSeconds >= run.rules.minActiveSeconds && p.contribution >= run.rules.target;
          if (p.qualified) s.awards.push({ id: `${run.id}:${p.playerId}`, runId: run.id, playerId: p.playerId, seasonId: run.seasonId, score: run.rules.score, at: now });
        }
      }
      return run;
    });
  }
  join(runId, playerId, actor) {
    id(playerId);
    return this.store.transact(actor, `participation.join:${runId}:${playerId}`, (s) => {
      const run = requireRun(s, runId);
      if (run.status !== 'active' || this.now() >= run.endsAt) throw new Error('Protocol is not active');
      let p = run.participants.find((x) => x.playerId === playerId);
      if (!p) { p = { playerId, joinedAt: this.now(), activeSeconds: 0, contribution: 0, disqualified: false }; run.participants.push(p); }
      return p;
    });
  }
  // Only a trusted adapter or staff verification may call this; joining never grants credit.
  record({ runId, playerId, source, eventId, map, metric, amount, at, intervalStart, evidence }, actor) {
    [runId, playerId, source, eventId, map, metric].forEach(id);
    if (typeof evidence !== 'string' || evidence.length < 3 || evidence.length > 500) throw new Error('Verification evidence required');
    integer(amount, 1, metric === 'active-seconds' ? 60 : 1);
    integer(at, 0, this.now());
    return this.store.transact(actor, `participation.record:${runId}:${source}:${eventId}`, (s) => {
      const receiptKey = `${source}:${eventId}`;
      const fingerprint = JSON.stringify({ runId, playerId, map, metric, amount, at, intervalStart, evidence });
      const receipt = s.receipts.find((x) => x.key === receiptKey);
      if (receipt) { if (receipt.fingerprint !== fingerprint) throw new Error('Event ID reused with different evidence'); return { duplicate: true }; }
      const run = requireRun(s, runId);
      const p = run.participants.find((x) => x.playerId === playerId);
      if (!p || p.disqualified) throw new Error('Participant missing or disqualified');
      if (run.status !== 'active' || this.now() >= run.endsAt || at < Math.max(p.joinedAt, run.activeSince) || at >= run.endsAt || !run.maps.includes(map)) throw new Error('Evidence outside active run or map scope');
      if (metric === 'active-seconds') {
        integer(intervalStart, Math.max(p.joinedAt, run.activeSince, p.lastActivityAt || 0), at - amount * 1000);
        if (at - intervalStart !== amount * 1000) throw new Error('Activity interval must match verified seconds');
        p.activeSeconds += amount; p.lastActivityAt = at;
      } else {
        if (metric !== run.definition.metric || metric === 'pvp-kill') throw new Error('Metric unavailable for this Protocol');
        p.contribution += amount;
      }
      s.receipts.push({ key: receiptKey, fingerprint, actor, acceptedAt: this.now() });
      return { accepted: true, participant: p };
    });
  }
  disqualify(runId, playerId, reason, actor) {
    if (!reason || reason.length > 500) throw new Error('Disqualification reason required');
    return this.store.transact(actor, `participation.disqualify:${runId}:${playerId}:${reason}`, (s) => {
      const run = requireRun(s, runId);
      if (!['active', 'paused'].includes(run.status)) throw new Error('Run is terminal');
      const p = run.participants.find((x) => x.playerId === playerId);
      if (!p) throw new Error('Participant not found');
      p.disqualified = true; p.reason = reason; return p;
    });
  }
  stats(playerId, seasonId) {
    const s = this.store.read();
    const runs = s.runs.filter((r) => (!seasonId || r.seasonId === seasonId) && r.participants.some((p) => p.playerId === playerId));
    const awards = s.awards.filter((a) => a.playerId === playerId && (!seasonId || a.seasonId === seasonId));
    return { playerId, seasonId: seasonId || 'lifetime', score: awards.reduce((n, a) => n + a.score, 0), completions: awards.length, participations: runs.length,
      activeSeconds: runs.reduce((n, r) => n + r.participants.find((p) => p.playerId === playerId).activeSeconds, 0) };
  }
  leaderboard(seasonId) {
    return [...new Set(this.store.read().awards.map((a) => a.playerId))].map((p) => this.stats(p, seasonId)).sort((a, b) => b.score - a.score || a.playerId.localeCompare(b.playerId)).slice(0, 20);
  }
}
module.exports = { ProtocolEngine, id, integer };

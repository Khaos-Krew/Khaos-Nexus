'use strict';
const { ProtocolStore } = require('./store.cjs');
const { id } = require('./engine.cjs');
const ACTIVATION_MS = 5 * 60_000;
const WITHDRAWAL_MS = 30 * 60_000;
const COMBAT_MS = 15 * 60_000;
const PAIR_MS = 60 * 60_000;
function effective(entry, now) {
  if (!entry) return 'SAFE';
  if (entry.state === 'PENDING') return now >= entry.activateAt ? 'ENLISTED' : 'PENDING';
  if (entry.state === 'COOLDOWN') return now >= Math.max(entry.withdrawAt, (entry.lastCombatAt || 0) + COMBAT_MS) ? 'SAFE' : 'COOLDOWN';
  return entry.state;
}
const vulnerable = (entry, now) => ['ENLISTED', 'COOLDOWN'].includes(effective(entry, now));

// Policy model only. No network-facing method can attest game protection readiness.
// An authoritative game adapter must enforce denials, ownership and combat callbacks.
class DarkZone {
  constructor({ store = new ProtocolStore(), now = Date.now, enforcementReady = () => false } = {}) {
    this.store = store; this.now = now; this.enforcementReady = enforcementReady;
  }
  subject(kind, subjectId) {
    if (!['player', 'tribe', 'tame'].includes(kind)) throw new Error('Unknown Dark Zone subject type');
    return `${kind}:${id(subjectId)}`;
  }
  status(kind, subjectId) {
    const key = this.subject(kind, subjectId);
    const entry = this.store.read().darkzone.find((x) => x.key === key);
    return { ...(entry || { key }), state: effective(entry, this.now()), enforcementReady: this.enforcementReady() === true };
  }
  enlist(kind, subjectId, actor, { confirmed = false, ownershipVerified = false } = {}) {
    if (this.enforcementReady() !== true) throw new Error('DARK ZONE // CONTAINED — game damage protection is not verified');
    if (!confirmed || !ownershipVerified) throw new Error('Explicit consent and verified ownership required');
    const key = this.subject(kind, subjectId);
    return this.store.transact(actor, `darkzone.enlist:${key}`, (s) => {
      let entry = s.darkzone.find((x) => x.key === key);
      if (entry && effective(entry, this.now()) !== 'SAFE') throw new Error('Dark Zone subject is already pending, enlisted, cooling down or suspended');
      if (!entry) { entry = { key }; s.darkzone.push(entry); }
      Object.assign(entry, { state: 'PENDING', activateAt: this.now() + ACTIVATION_MS, consentBy: actor, ownerId: actor, consentAt: this.now() });
      return entry;
    });
  }
  withdraw(kind, subjectId, actor, { ownershipVerified = false } = {}) {
    if (!ownershipVerified) throw new Error('Verified ownership required');
    const key = this.subject(kind, subjectId);
    return this.store.transact(actor, `darkzone.withdraw:${key}`, (s) => {
      const entry = s.darkzone.find((x) => x.key === key);
      const current = effective(entry, this.now());
      if (current === 'COOLDOWN') return entry; // Repeated requests cannot reset or shorten the deadline.
      if (current === 'PENDING') { entry.state = 'SAFE'; return entry; }
      if (current !== 'ENLISTED') throw new Error('Subject is not enlisted');
      entry.state = 'COOLDOWN'; entry.withdrawAt = Math.max(this.now() + WITHDRAWAL_MS, (entry.lastCombatAt || 0) + COMBAT_MS); return entry;
    });
  }
  // Entity ownership must come from the game, never Discord input. Missing owners deny damage.
  allowed(state, attacker, target) {
    if (this.enforcementReady() !== true || !attacker?.playerId || !attacker?.tribeId || !target?.tribeId || attacker.tribeId === target.tribeId) return false;
    const active = (key) => vulnerable(state.darkzone.find((x) => x.key === key), this.now());
    if (!active(`player:${attacker.playerId}`)) return false;
    if (target.kind === 'player') return !!target.playerId && target.playerId !== attacker.playerId && active(`player:${target.playerId}`);
    if (target.kind === 'structure') return active(`tribe:${attacker.tribeId}`) && active(`tribe:${target.tribeId}`);
    if (target.kind === 'tame') {
      const enrollment = state.darkzone.find((x) => x.key === `tame:${target.id}`);
      return (!!target.id && !!target.ownerId && enrollment?.ownerId === target.ownerId && vulnerable(enrollment, this.now())) || (active(`tribe:${attacker.tribeId}`) && active(`tribe:${target.tribeId}`));
    }
    return false;
  }
  canDamage(attacker, target) { return this.allowed(this.store.read(), attacker, target); }
  suspend(kind, subjectId, reason, actor) {
    if (!reason || reason.length > 500) throw new Error('Suspension reason required');
    const key = this.subject(kind, subjectId);
    return this.store.transact(actor, `darkzone.suspend:${key}:${reason}`, (s) => {
      let entry = s.darkzone.find((x) => x.key === key);
      if (!entry) { entry = { key }; s.darkzone.push(entry); }
      entry.state = 'SUSPENDED'; entry.reason = reason; return entry;
    });
  }
  combat(attacker, target, eventId, actor) {
    id(eventId);
    return this.store.transact(actor, `darkzone.combat:${eventId}`, (s) => {
      if (!this.allowed(s, attacker, target)) throw new Error('PvP denied by protection policy');
      const key = `darkzone-combat:${eventId}`;
      if (s.receipts.some((x) => x.key === key)) return { duplicate: true };
      const subjects = [`player:${attacker.playerId}`, `tribe:${attacker.tribeId}`, `tribe:${target.tribeId}`, `${target.kind}:${target.kind === 'player' ? target.playerId : target.id}`];
      for (const entry of s.darkzone.filter((x) => subjects.includes(x.key))) entry.lastCombatAt = this.now();
      s.receipts.push({ key, at: this.now() });
      return { recorded: true };
    });
  }
  validateKill(attacker, target, eventId, actor) {
    id(eventId);
    return this.store.transact(actor, `darkzone.kill:${eventId}`, (s) => {
      if (target.kind !== 'player' || !this.allowed(s, attacker, target)) throw new Error('Invalid PvP kill');
      const key = `darkzone-kill:${eventId}`;
      const pair = [attacker.playerId, target.playerId].sort().join(':');
      if (s.receipts.some((x) => x.key === key || x.pair === pair && this.now() - x.at < PAIR_MS)) return { eligible: false, reason: 'duplicate-or-repeat-pair' };
      s.receipts.push({ key, pair, at: this.now() });
      return { eligible: true }; // Eligibility only; never mint currency or score here.
    });
  }
}
module.exports = { DarkZone, effective, ACTIVATION_MS, WITHDRAWAL_MS, COMBAT_MS, PAIR_MS };

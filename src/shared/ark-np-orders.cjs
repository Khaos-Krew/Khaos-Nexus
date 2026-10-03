'use strict';

const REFUND_AFTER_MS = 14 * 24 * 60 * 60 * 1000;
const STAFF_REFUND_DAILY_CAP = 10;
const STAFF_REFUND_ALERT_AT = 5;
const AUDIT_RETAIN_MS = 365 * 24 * 60 * 60 * 1000;
const SPEND_ALERT_24H_POINTS = 1500;
const PREPARE_LEASE_MS = 2 * 60 * 1000;
const DELIVERY_LEASE_MS = 10 * 60 * 1000;
const QUOTE_TTL_MS = 120 * 1000;
const FINAL_STATUSES = new Set(['REFUNDED', 'DELIVERED']);

function offlineBackoffMs(attempts) {
  const step = Math.max(1, Math.floor(Number(attempts) || 1));
  return Math.min(step, 30) * 60 * 1000;
}

function ledgerKey(econId, sku, nonce) {
  return `np-shop:ark:${econId}:${sku}:${nonce}`;
}

function refundKey(orderId) {
  return `np-shop-refund:${orderId}`;
}

function refundDecision(order, { now = Date.now(), staff = false, actor = '', reason = '' } = {}) {
  if (!order) return { ok: false, reason: 'order-not-found' };
  if (order.status === 'REFUNDED') return { ok: true, duplicate: true, order };
  if (order.status === 'DELIVERED') return { ok: false, reason: 'illegal-transition' };
  if (staff) {
    if (!String(reason || '').trim()) return { ok: false, reason: 'reason-required' };
    if (!String(actor || '').trim()) return { ok: false, reason: 'reason-required' };
    if (String(actor) === String(order.discordUserId || '')) return { ok: false, reason: 'self-refund' };
    if (order.status !== 'SENT_UNCONFIRMED' && order.status !== 'DELIVERY_FAILED') {
      return { ok: false, reason: 'illegal-transition' };
    }
    return { ok: true };
  }
  if (order.status === 'SENT_UNCONFIRMED') return { ok: false, reason: 'illegal-transition' };
  if (order.status === 'DELIVERY_FAILED') return { ok: true };
  if (order.status === 'PAID' || order.status === 'PLAYER_OFFLINE') {
    const paidAt = Date.parse(order.paidAt || order.createdAt || '');
    if (!Number.isFinite(paidAt) || now - paidAt < REFUND_AFTER_MS) return { ok: false, reason: 'illegal-transition' };
    return { ok: true };
  }
  if (FINAL_STATUSES.has(order.status)) return { ok: false, reason: 'illegal-transition' };
  return { ok: false, reason: 'illegal-transition' };
}

module.exports = {
  REFUND_AFTER_MS,
  STAFF_REFUND_DAILY_CAP,
  STAFF_REFUND_ALERT_AT,
  AUDIT_RETAIN_MS,
  SPEND_ALERT_24H_POINTS,
  PREPARE_LEASE_MS,
  DELIVERY_LEASE_MS,
  QUOTE_TTL_MS,
  FINAL_STATUSES,
  offlineBackoffMs,
  ledgerKey,
  refundKey,
  refundDecision
};

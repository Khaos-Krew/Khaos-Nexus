'use strict';

const { catalogItem } = require('./coin-shop-catalog.cjs');
const {
  QUOTE_TTL_MS,
  REFUND_WINDOW_MS,
  ATTEMPT_LIMIT,
  DAILY_SPEND_CAP,
  purchaseKey,
  refundKey
} = require('./coin-shop-limits.cjs');

function halt(result) {
  return { result, effects: [] };
}

function withAttempt(now, econId, result) {
  if (!econId) return halt(result);
  return { result, effects: [{ type: 'attempt', at: now, econId }] };
}

function identityEligible(identity) {
  if (!identity) return false;
  if (!identity.verifiedAt) return false;
  if (identity.status !== 'verified') return false;
  if (identity.held) return false;
  if (identity.quarantined) return false;
  if (identity.rankId === 'shadow-recruit') return false;
  return true;
}

function requestedCurrency(input) {
  if (input?.currency == null || String(input.currency).trim() === '') return 'NEXUS_COINS';
  return String(input.currency).trim();
}

function ceilingReady(limits) {
  return Number.isSafeInteger(limits?.ceiling) && limits.ceiling >= 1;
}

function decideQuote(state, input, now, limits, nonce) {
  if (requestedCurrency(input) !== 'NEXUS_COINS') return halt({ ok: false, reason: 'currency-rejected' });
  if (input?.recipientUserId && String(input.recipientUserId) !== String(input.discordUserId || '')) {
    return halt({ ok: false, reason: 'no-gifting' });
  }
  if (!ceilingReady(limits)) return halt({ ok: false, reason: 'ceiling-unset' });
  const sku = String(input?.sku || '').trim();
  const item = catalogItem(sku);
  if (!item) return halt({ ok: false, reason: 'unknown-sku' });
  if (item.price > limits.ceiling) return halt({ ok: false, reason: 'ceiling' });
  if (!identityEligible(state.identity)) return halt({ ok: false, reason: 'not-eligible' });
  if (state.owned) return halt({ ok: false, reason: 'owned' });
  if (Number(state.spentToday || 0) + item.price > DAILY_SPEND_CAP) return halt({ ok: false, reason: 'daily-cap' });
  if (Number(state.attemptCount || 0) >= ATTEMPT_LIMIT) return halt({ ok: false, reason: 'rate-limited' });
  const balance = Number(state.balance || 0);
  if (balance < item.price) return halt({ ok: false, reason: 'insufficient-coins', balance });
  const expiresAt = new Date(now + QUOTE_TTL_MS).toISOString();
  return {
    result: {
      ok: true,
      quote: {
        nonce,
        discordUserId: String(input.discordUserId),
        economicIdentityId: state.identity.econId,
        sku,
        label: item.label,
        slot: item.slot,
        price: item.price,
        balance,
        balanceAfter: balance - item.price,
        expiresAt
      }
    },
    effects: [
      { type: 'attempt', at: now, econId: state.identity.econId },
      {
        type: 'save-quote',
        nonce,
        discordUserId: String(input.discordUserId),
        econId: state.identity.econId,
        sku,
        price: item.price,
        expectedBalance: balance,
        expiresAt
      }
    ]
  };
}

function decidePurchase(state, input, now, limits) {
  if (requestedCurrency(input) !== 'NEXUS_COINS') return halt({ ok: false, reason: 'currency-rejected' });
  if (input?.recipientUserId && String(input.recipientUserId) !== String(input.discordUserId || '')) {
    return halt({ ok: false, reason: 'no-gifting' });
  }
  if (!ceilingReady(limits)) return halt({ ok: false, reason: 'ceiling-unset' });
  if (state.replay) {
    return halt({
      ok: true,
      duplicate: true,
      balance: state.replay.balanceAfter,
      ledgerId: state.replay.ledgerId,
      ledgerRef: state.replay.ledgerRef,
      sku: state.replay.sku,
      price: state.replay.price,
      slot: state.replay.slot,
      label: state.replay.label,
      entitlement: state.replay.entitlement || null
    });
  }
  const econId = state.identity?.econId || '';
  if (!identityEligible(state.identity)) return halt({ ok: false, reason: 'not-eligible' });
  if (Number(state.attemptCount || 0) >= ATTEMPT_LIMIT) return halt({ ok: false, reason: 'rate-limited' });
  const sku = String(input?.sku || '').trim();
  const item = catalogItem(sku);
  if (!item) return withAttempt(now, econId, { ok: false, reason: 'unknown-sku' });
  if (item.price > limits.ceiling) return withAttempt(now, econId, { ok: false, reason: 'ceiling' });
  const nonce = String(input?.nonce || '').trim();
  const quote = state.quote;
  if (!quote || quote.consumed || quote.nonce !== nonce || Date.parse(quote.expiresAt) <= now) {
    return withAttempt(now, econId, { ok: false, reason: 'expired' });
  }
  if (quote.discordUserId !== String(input.discordUserId || '') || quote.sku !== sku || quote.econId !== econId) {
    return withAttempt(now, econId, { ok: false, reason: 'mismatch' });
  }
  if (state.owned) return withAttempt(now, econId, { ok: false, reason: 'owned' });
  if (Number(state.spentToday || 0) + item.price > DAILY_SPEND_CAP) {
    return withAttempt(now, econId, { ok: false, reason: 'daily-cap' });
  }
  const balance = Number(state.balance || 0);
  if (balance !== Number(quote.expectedBalance)) return withAttempt(now, econId, { ok: false, reason: 'balance-changed', balance });
  if (balance < item.price) return withAttempt(now, econId, { ok: false, reason: 'insufficient-coins', balance });
  const next = balance - item.price;
  const ledgerRef = purchaseKey(econId, sku, nonce);
  return {
    result: {
      ok: true,
      duplicate: false,
      balance: next,
      previousBalance: balance,
      ledgerRef,
      sku,
      price: item.price,
      slot: item.slot,
      label: item.label
    },
    effects: [
      { type: 'attempt', at: now, econId },
      { type: 'cas-debit', econId, expected: balance, next, currency: 'NEXUS_COINS' },
      {
        type: 'ledger',
        econId,
        currency: 'NEXUS_COINS',
        amount: -item.price,
        balanceAfter: next,
        entryType: 'purchase',
        source: 'sink:coin-shop',
        key: ledgerRef,
        metadata: { sku, price: item.price, nonce, sink: 'sink:coin-shop' }
      },
      {
        type: 'entitlement',
        econId,
        discordUserId: String(input.discordUserId),
        sku,
        price: item.price,
        status: 'active'
      },
      { type: 'consume-quote', nonce }
    ]
  };
}

function decideRefund(state, input, now) {
  if (!String(input?.reason || '').trim()) return halt({ ok: false, reason: 'reason-required' });
  if (!String(input?.actor || '').trim()) return halt({ ok: false, reason: 'staff-required' });
  if (requestedCurrency(input) !== 'NEXUS_COINS') return halt({ ok: false, reason: 'currency-rejected' });
  const purchase = state.purchase;
  if (!purchase) return halt({ ok: false, reason: 'not-found' });
  if (state.held) return halt({ ok: false, reason: 'member-held' });
  if (purchase.currency !== 'NEXUS_COINS') return halt({ ok: false, reason: 'currency-rejected' });
  const key = refundKey(purchase.ledgerId);
  if (purchase.refunded) {
    return halt({
      ok: true,
      duplicate: true,
      balance: Number(state.balance || 0),
      ledgerRef: key,
      refundedLedgerId: purchase.ledgerId,
      sku: purchase.sku,
      discordUserId: purchase.discordUserId || ''
    });
  }
  if (purchase.equippedAt) return halt({ ok: false, reason: 'already-used' });
  if (!Number.isFinite(purchase.createdAt) || now - purchase.createdAt > REFUND_WINDOW_MS) {
    return halt({ ok: false, reason: 'refund-window' });
  }
  const price = Number(purchase.price || 0);
  if (!Number.isSafeInteger(price) || price < 1) return halt({ ok: false, reason: 'not-found' });
  const balance = Number(state.balance || 0);
  const next = balance + price;
  return {
    result: {
      ok: true,
      duplicate: false,
      balance: next,
      ledgerRef: key,
      refundedLedgerId: purchase.ledgerId,
      sku: purchase.sku,
      price,
      discordUserId: purchase.discordUserId || ''
    },
    effects: [
      { type: 'cas-credit', econId: purchase.econId, expected: balance, next, currency: 'NEXUS_COINS' },
      {
        type: 'ledger',
        econId: purchase.econId,
        currency: 'NEXUS_COINS',
        amount: price,
        balanceAfter: next,
        entryType: 'refund',
        source: 'sink:coin-shop',
        key,
        metadata: { sku: purchase.sku, refundOf: purchase.ledgerId, sink: 'sink:coin-shop' }
      },
      { type: 'refund-entitlement', econId: purchase.econId, sku: purchase.sku },
      {
        type: 'audit',
        action: 'refund',
        actor: String(input.actor),
        reason: String(input.reason).slice(0, 400),
        ledgerId: purchase.ledgerId,
        sku: purchase.sku
      }
    ]
  };
}

module.exports = {
  identityEligible,
  decideQuote,
  decidePurchase,
  decideRefund,
  QUOTE_TTL_MS
};

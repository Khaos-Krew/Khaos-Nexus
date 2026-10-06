'use strict';

const { coinShopReceiptRef } = require('./coin-shop-limits.cjs');

const GATE_OFF = 'The Coin shop isn\'t open yet.';
const COSMETIC_FOOTER = 'Cosmetic only. No gameplay effect.';
const INELIGIBLE = 'This account cannot use the Coin shop right now. Ask a staff member to verify this Discord account.';

const REASONS = Object.freeze({
  'not-eligible': INELIGIBLE,
  'insufficient-coins': 'You do not have enough Coins. Earn Coins by chatting, spending time in voice, levelling up, and joining events.',
  owned: 'You already own that.',
  'daily-cap': 'That would go over today\'s Coin limit.',
  ceiling: 'That item costs more than the shop allows.',
  'ceiling-unset': 'The Coin shop isn\'t open yet.',
  'unknown-sku': 'That item is not in the shop.',
  'currency-rejected': 'The Coin shop only spends Coins.',
  'no-gifting': 'You can only buy for yourself.',
  expired: 'That confirmation expired. Open /shop again. No Coins were spent.',
  mismatch: 'That confirmation does not match this item. Open /shop again. No Coins were spent.',
  'balance-changed': 'Your Coin balance changed. Open /shop again. No Coins were spent.',
  'rate-limited': 'Too many shop attempts. Wait a few minutes. No Coins were spent.',
  'in-flight': 'A Coin shop purchase is already in progress. No extra Coins were spent.',
  'economy-coin-shop-spend-not-enabled': GATE_OFF,
  'coin-shop-unavailable': 'The Coin shop isn\'t open yet.',
  'already-used': 'That item was already equipped. It was not refunded.',
  'revoke-failed': 'That item could not be removed, so it was not refunded.',
  'refund-window': 'That purchase is older than 24 hours. It was not refunded.',
  'not-found': 'That purchase was not found. Nothing was refunded.',
  'staff-required': 'That command is for a staff admin.',
  'member-held': 'That member is on hold. The refund was not applied.',
  'reason-required': 'A refund needs a reason. Nothing was refunded.',
  'self-refund': 'Nothing was refunded. Ask another staff admin to do this refund.',
  'refund-cap': 'Nothing was refunded. Ask another staff admin, or try again after 12:00 AM Central.',
  'staff-unlinked': 'Nothing was refunded. Your staff account isn\'t linked to the economy yet. Ask another staff admin to do this refund.'
});

function coinShopMemberText(reason = '', details = {}) {
  if (String(reason || '') === 'insufficient-coins') {
    const shortfall = Number(details.shortfall);
    const need = Number.isFinite(shortfall) && shortfall > 0
      ? `You need ${shortfall.toLocaleString('en-US')} more Coins.`
      : 'You do not have enough Coins.';
    return `${need} Earn Coins by chatting, spending time in voice, levelling up, and joining events.`;
  }
  const known = REASONS[String(reason || '')];
  if (known) return known;
  return 'The Coin shop could not do that. No Coins were spent.';
}

function memberReceipt(result = {}) {
  const ref = coinShopReceiptRef(result.ledgerId);
  const line = ref ? `Ref: ${ref}` : 'Ref: unavailable';
  return `New balance: ${Number(result.balance).toLocaleString('en-US')} Coins\n${line}`;
}

module.exports = {
  GATE_OFF,
  COSMETIC_FOOTER,
  INELIGIBLE,
  coinShopMemberText,
  memberReceipt
};

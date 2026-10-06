'use strict';

const { MEMBER_HOLD_MESSAGE } = require('../sentinel/nexus-economy-identity-hold.cjs');

const REASONS = Object.freeze({
  'ark-shop-disabled': 'The ARK shop is turned off. No Points were spent.',
  'ark-shop-delivery-disabled': 'Delivery is turned off. If you already paid, your order stays queued.',
  'ark-starter-kit-disabled': 'The starter kit is turned off. It was not claimed.',
  'ark-shop-dry-run': 'The shop is in preview. No Points were spent.',
  'economy-np-shop-writes-not-enabled': 'The shop cannot spend Points yet. No Points were spent.',
  'quote-expired': 'That price check expired. Open the shop again. No Points were spent.',
  'quote-mismatch': 'That price check does not match this purchase. Open the shop again. No Points were spent.',
  'insufficient-funds': 'You do not have enough Points for that.',
  'quarantined': 'This account cannot use the shop right now. Ask a staff member.',
  'not-eligible': 'This account cannot use the shop right now. Ask a staff member.',
  'restricted': 'This account is restricted. Your Points stay as they are. Ask a staff member if that looks wrong.',
  'disabled': 'This account is turned off. Ask a staff member.',
  'account-hold': MEMBER_HOLD_MESSAGE,
  'minecraft-only': 'This Discord account is linked to Minecraft. `/points` shows the one Points wallet Minecraft and ARK share. Nothing was spent.',
  'verified-identity-required': 'Run `/ark link` to connect this Discord account, then use `/points` again.',
  'verified-eos-required': 'Run `/ark link` and finish the in-game check, then use `/points` again.',
  'already-claimed': 'The starter kit was already claimed for this player.',
  'staff-required': 'That command is for staff.',
  'schema-missing': 'The bank is not ready yet. Ask a staff member. No Points were spent.',
  'unknown-item': 'That item is not in the shop.',
  'currency-not-accepted': 'That cache does not accept that currency. Nothing was spent.',
  'price-changed': 'The price changed. Open the shop again. No Points were spent.',
  'staff-refund-cap': 'That staff member has reached today’s refund limit.',
  'self-refund': 'You cannot refund your own order.',
  'illegal-transition': 'That order cannot be changed that way.',
  'order-not-found': 'That order was not found.',
  'reason-required': 'A reason is required.',
  'lease-lost': 'Delivery lost its turn. The order was not marked delivered.',
  'player-offline': 'You are not online on one map yet. The order stays queued.',
  'delivery-failed': 'Delivery did not finish. If Points were spent and nothing was sent, they are returned.',
  'sent-unconfirmed': 'Delivery needs a staff member to check it. Your Points stay spent until staff decide.'
});

function arkMemberText(reason, fallback = 'Something went wrong. No extra Points were spent. If your balance looks wrong, ask a staff member.') {
  const key = String(reason || '').trim();
  return REASONS[key] || fallback;
}

function orderStatusText(status) {
  const value = String(status || '');
  if (value === 'DELIVERED') return 'Delivered';
  if (value === 'SENT_UNCONFIRMED' || value === 'DELIVERY_FAILED') return 'Needs staff';
  if (value === 'REFUNDED') return 'Refunded';
  return 'Queued (offline until you are on one map)';
}

function ledgerLineText(row = {}) {
  const amount = Number(row.amount || 0);
  const parsed = Date.parse(row.createdAt || '');
  const when = Number.isFinite(parsed) ? `<t:${Math.floor(parsed / 1000)}:R>` : '';
  const direction = amount > 0 ? `+${amount} Points` : `${amount} Points`;
  const source = String(row.source || '');
  let label = 'Points update';
  if (source === 'legacy_bank_flat') label = 'One-time bank credit';
  else if (source === 'np-shop' || source === 'sink:ark-shop' || source === 'ark-shop') label = 'Shop purchase';
  else if (source.includes('refund') || row.entryType === 'reversal') label = 'Refund';
  else if (source.includes('playtime') || source.includes('accrual')) label = 'Playtime';
  return `${when} ${label}: ${direction}`.trim();
}

module.exports = { arkMemberText, orderStatusText, ledgerLineText, REASONS };

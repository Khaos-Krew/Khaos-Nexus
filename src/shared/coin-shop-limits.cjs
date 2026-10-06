'use strict';

const QUOTE_TTL_MS = 120 * 1000;
const REFUND_WINDOW_MS = 24 * 60 * 60 * 1000;
const ATTEMPT_WINDOW_MS = 10 * 60 * 1000;
const ATTEMPT_LIMIT = 5;
const ATTEMPT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DAILY_SPEND_CAP = 1500;
const CHICAGO = 'America/Chicago';

function purchaseKey(econId, sku, nonce) {
  return `coin-shop:${econId}:${sku}:${nonce}`;
}

function refundKey(ledgerId) {
  return `coin-shop-refund:${ledgerId}`;
}

function coinShopReceiptRef(ledgerId) {
  const id = Number(ledgerId);
  if (!Number.isSafeInteger(id) || id < 1) return '';
  return `CS-${String(id).padStart(4, '0')}`;
}

function coinShopLedgerIdFromRef(ref) {
  const match = /^CS-(\d+)$/i.exec(String(ref || '').trim());
  if (!match) return null;
  const id = Number(match[1]);
  if (!Number.isSafeInteger(id) || id < 1) return null;
  return id;
}

function chicagoParts(ms) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: CHICAGO,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  });
  const parts = {};
  for (const part of fmt.formatToParts(new Date(ms))) parts[part.type] = part.value;
  return parts;
}

function chicagoDayKey(ms) {
  const parts = chicagoParts(ms);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function chicagoDayStart(ms) {
  const parts = chicagoParts(ms);
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  for (let hour = 0; hour <= 12; hour += 1) {
    const candidate = Date.UTC(year, month - 1, day, hour, 0, 0);
    const seen = chicagoParts(candidate);
    if (seen.year === parts.year && seen.month === parts.month && seen.day === parts.day && seen.hour === '00' && seen.minute === '00') {
      return candidate;
    }
  }
  return Date.UTC(year, month - 1, day, 6, 0, 0);
}

module.exports = {
  QUOTE_TTL_MS,
  REFUND_WINDOW_MS,
  ATTEMPT_WINDOW_MS,
  ATTEMPT_LIMIT,
  ATTEMPT_RETENTION_MS,
  DAILY_SPEND_CAP,
  CHICAGO,
  purchaseKey,
  refundKey,
  coinShopReceiptRef,
  coinShopLedgerIdFromRef,
  chicagoDayKey,
  chicagoDayStart
};

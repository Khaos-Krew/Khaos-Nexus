'use strict';

const TEMPORAL_KEYS = new Set([
  'date','datetime','timestamp','start','starts','startsat','end','ends','endsat','expiry','expires','expiresat',
  'activation','createdat','updatedat','resetat','nextat','lastattemptat','publishedat','scheduledat'
]);
const EXPLICIT_ZONE = /(?:Z|[+-]\d{2}:?\d{2}|\bUTC\b|\bGMT\b)$/i;
const LOCAL_TIME = /\blocal\s+time\b/i;

function cleanTimeText(value, max = 240) {
  return String(value ?? '').replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function temporalKey(key = '') {
  return TEMPORAL_KEYS.has(String(key || '').toLowerCase().replace(/[^a-z0-9]/g, ''));
}

function absoluteUnix(value, key = '') {
  if (value === null || value === undefined || value === '') return null;
  const keyed = temporalKey(key);
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (!keyed) return null;
    const ms = value > 1e12 ? value : value > 1e9 ? value * 1000 : NaN;
    return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
  }
  const text = cleanTimeText(value, 300);
  if (!text || LOCAL_TIME.test(text)) return null;
  const looksTemporal = keyed || /\d{4}-\d{2}-\d{2}T/.test(text);
  if (!looksTemporal) return null;
  if (!EXPLICIT_ZONE.test(text) && !/[+-]\d{2}:?\d{2}(?:\s|$)/.test(text)) return null;
  const ms = Date.parse(text);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

function discordTimestamp(value, key = '', style = 'F') {
  const unix = absoluteUnix(value, key);
  return unix === null ? '' : `<t:${unix}:${style}>`;
}

function discordTimestampPair(value, key = '') {
  const unix = absoluteUnix(value, key);
  if (unix === null) return '';
  return `<t:${unix}:F> • <t:${unix}:R>`;
}

function renderTemporal(value, key = '') {
  if (value === null || value === undefined || value === '') return '';
  const text = cleanTimeText(value, 1000);
  const rendered = discordTimestampPair(value, key);
  return rendered || text;
}

function isLocalTimeText(value) {
  return LOCAL_TIME.test(cleanTimeText(value, 300));
}

module.exports = { absoluteUnix, discordTimestamp, discordTimestampPair, renderTemporal, isLocalTimeText, cleanTimeText, temporalKey };

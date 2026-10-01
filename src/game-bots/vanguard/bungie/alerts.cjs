'use strict';

const WINDOW_MS = 30 * 60 * 1000;

function createAlerter({ now = Date.now, send, windowMs = WINDOW_MS } = {}) {
  const last = new Map();

  async function alert(kind, text) {
    const key = String(kind || 'unavailable');
    const at = now();
    const prev = last.get(key) || 0;
    if (prev && at - prev < windowMs) return { sent: false, reason: 'rate' };
    last.set(key, at);
    if (typeof send === 'function') await send(String(text || '').slice(0, 1800));
    return { sent: true };
  }

  return { alert, windowMs };
}

function alertText(kind, detail = '') {
  if (kind === 'auth') return 'API key invalid or misconfigured.';
  if (kind === 'disabled') return 'Bungie system disabled.';
  const cause = detail === 'timeout' || detail === 'network'
    ? 'timeout'
    : detail === 'server'
      ? 'server error'
      : detail === 'rate limit'
        ? 'rate limit'
        : detail === 'http-403'
          ? 'HTTP 403'
          : detail === 'html'
            ? 'HTML'
            : 'HTML or HTTP 403';
  return `Bungie data unavailable (${cause}). No workaround will be attempted.`;
}

module.exports = { WINDOW_MS, createAlerter, alertText };

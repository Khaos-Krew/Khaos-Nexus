'use strict';

const RETRY_CODES = new Set([31, 35, 36, 37, 51, 54, 55, 56, 57, 1672]);
const AUTH_STOP_CODES = new Set([2101, 2102, 2107]);
const THROTTLE_CAP_SECONDS = 60;

function looksLikeHtml(contentType, body) {
  const type = String(contentType || '').toLowerCase();
  if (type.includes('text/html') || type.includes('application/xhtml')) return true;
  const text = String(body || '').trimStart().slice(0, 64).toLowerCase();
  return text.startsWith('<!doctype html') || text.startsWith('<html') || text.startsWith('<head') || text.startsWith('<body');
}

function finiteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function successBody(json, errorCode) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return false;
  if (!Object.prototype.hasOwnProperty.call(json, 'ErrorCode')) return false;
  if (!Object.prototype.hasOwnProperty.call(json, 'Response')) return false;
  return errorCode === 0 || errorCode === 1;
}

function classifyResponse({ status = 0, contentType = '', bodyText = '', json = null } = {}) {
  const errorCode = finiteNumber(json?.ErrorCode);
  const throttleSeconds = Math.min(THROTTLE_CAP_SECONDS, Math.max(0, finiteNumber(json?.ThrottleSeconds)));
  const html = looksLikeHtml(contentType, bodyText);
  if (html || status === 403) {
    return {
      kind: 'unavailable',
      reason: status === 403 ? 'http-403' : 'html',
      retry: false,
      errorCode,
      throttleSeconds: 0,
      alert: 'unavailable'
    };
  }
  if (errorCode === 5) {
    return { kind: 'unavailable', reason: 'system-disabled', retry: false, errorCode, throttleSeconds, alert: 'disabled' };
  }
  if (AUTH_STOP_CODES.has(errorCode)) {
    return { kind: 'auth', reason: 'api-key', retry: false, errorCode, throttleSeconds: 0, alert: 'auth' };
  }
  if (errorCode === 2111 || status === 401) {
    return { kind: 'auth', reason: 'unauthorized', retry: false, errorCode: errorCode || 2111, throttleSeconds: 0, alert: 'auth' };
  }
  if (errorCode === 1665) {
    return { kind: 'privacy', reason: 'private', retry: false, errorCode, throttleSeconds: 0, alert: '' };
  }
  if (errorCode === 1601) {
    return { kind: 'not-found', reason: 'no-account', retry: false, errorCode, throttleSeconds: 0, alert: '' };
  }
  if (RETRY_CODES.has(errorCode) || status === 429 || (status >= 500 && status <= 599)) {
    return {
      kind: 'retry',
      reason: status === 429 || RETRY_CODES.has(errorCode) ? 'throttle' : 'server',
      retry: true,
      errorCode: errorCode || status,
      throttleSeconds,
      alert: ''
    };
  }
  if (status >= 200 && status < 300 && successBody(json, errorCode)) {
    return { kind: 'ok', reason: 'success', retry: false, errorCode: errorCode || 1, throttleSeconds, alert: '' };
  }
  if (status >= 200 && status < 300 && (errorCode === 0 || errorCode === 1)) {
    return { kind: 'unavailable', reason: 'bad-body', retry: false, errorCode: errorCode || 0, throttleSeconds: 0, alert: '' };
  }
  if (errorCode && errorCode !== 1) {
    return { kind: 'error', reason: 'platform', retry: false, errorCode, throttleSeconds, alert: '' };
  }
  return { kind: 'error', reason: 'http', retry: false, errorCode: errorCode || status, throttleSeconds, alert: '' };
}

function backoffMs(attempt, random = Math.random) {
  const step = Math.max(0, Number(attempt) || 0);
  const base = Math.min(30000, 1000 * (2 ** step));
  const factor = 0.8 + (Number(random()) * 0.4);
  return Math.max(1, Math.round(base * factor));
}

module.exports = {
  RETRY_CODES,
  AUTH_STOP_CODES,
  THROTTLE_CAP_SECONDS,
  looksLikeHtml,
  successBody,
  classifyResponse,
  backoffMs
};

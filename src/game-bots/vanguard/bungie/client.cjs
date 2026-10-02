'use strict';

const { bungieConfig } = require('../config.cjs');
const { classifyResponse, backoffMs, THROTTLE_CAP_SECONDS } = require('./errors.cjs');
const { createLimiter } = require('./limiter.cjs');
const { alertText } = require('./alerts.cjs');
const { updateBungieStatus } = require('./status-snapshot.cjs');

const PLATFORM = 'https://www.bungie.net/Platform';
const MAX_RETRIES = 3;

const GET_PATHS = Object.freeze([
  /^\/Settings\/$/,
  /^\/Destiny2\/Manifest\/$/,
  /^\/Destiny2\/Milestones\/$/,
  /^\/Destiny2\/Milestones\/\d+\/Content\/$/,
  /^\/Destiny2\/Vendors\/$/,
  /^\/Destiny2\/\d+\/Profile\/\d+\/$/,
  /^\/Destiny2\/\d+\/Profile\/\d+\/LinkedProfiles\/$/,
  /^\/GroupV2\/\d+\/$/,
  /^\/GroupV2\/\d+\/Members\/$/,
  /^\/GroupV2\/\d+\/AdminsAndFounder\/$/
]);

const POST_PATHS = Object.freeze([
  /^\/Destiny2\/SearchDestinyPlayerByBungieName\/-1\/$/
]);

function endpointOf(path) {
  const clean = String(path || '').split('?')[0];
  return clean.startsWith('/') ? clean : `/${clean}`;
}

function allowed(method, path) {
  const endpoint = endpointOf(path);
  const rules = method === 'POST' ? POST_PATHS : GET_PATHS;
  return rules.some((rule) => rule.test(endpoint));
}

function contentUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = raw.startsWith('/') ? new URL(raw, 'https://www.bungie.net') : new URL(raw);
    if (url.protocol !== 'https:' || url.hostname !== 'www.bungie.net') return '';
    if (!url.pathname.includes('/common/destiny2_content/')) return '';
    return url.toString();
  } catch {
    return '';
  }
}

function redact(text, secret) {
  const raw = String(text || '');
  if (!secret) return raw;
  return raw.split(secret).join('[redacted]');
}

function headerMap(response) {
  const headers = response?.headers;
  return {
    get(name) {
      if (!headers) return '';
      if (typeof headers.get === 'function') return String(headers.get(name) || '');
      const key = Object.keys(headers).find((item) => item.toLowerCase() === String(name).toLowerCase());
      return key ? String(headers[key] || '') : '';
    }
  };
}

function createBungieClient({
  env = process.env,
  fetch: fetchImpl = globalThis.fetch,
  limiter,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now = Date.now,
  random = Math.random,
  alert,
  log = console.log,
  warn = console.warn
} = {}) {
  const config = bungieConfig(env);
  const doFetch = fetchImpl || globalThis.fetch;
  const wait = sleep || ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  const roll = random || Math.random;
  const bucket = limiter || createLimiter({ rps: config.rps, now, sleep: wait });
  const inflight = new Map();
  const lanes = new Map();
  let stopped = false;
  let settingsLogged = false;
  let deadline = 0;

  function beginBudget(until) {
    if (deadline > 0) return false;
    const at = Number(until);
    if (!(at > 0)) return false;
    deadline = at;
    return true;
  }

  function endBudget() {
    deadline = 0;
  }

  function budgetBlocks(extraMs = 0) {
    return deadline > 0 && now() + extraMs >= deadline;
  }

  function headers() {
    return {
      'X-API-Key': config.apiKey,
      'User-Agent': config.userAgent,
      Accept: 'application/json'
    };
  }

  function note(line) {
    log(redact(line, config.apiKey));
  }

  function problem(line) {
    warn(redact(line, config.apiKey));
  }

  function laneLock(endpoint, task) {
    const prev = lanes.get(endpoint) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    const waiting = prev.then(() => gate, () => gate);
    lanes.set(endpoint, waiting);
    return prev.then(task, task).finally(() => release());
  }

  function alertDetail(last) {
    if (last?.reason === 'timeout' || last?.reason === 'network') return 'timeout';
    if (last?.reason === 'html') return 'html';
    if (last?.reason === 'http-403' || last?.status === 403) return 'http-403';
    if ((last?.status >= 500 && last?.status <= 599) || last?.reason === 'server') return 'server';
    if (last?.status === 429 || last?.reason === 'throttle') return 'rate limit';
    return last?.reason || '';
  }

  async function sendAlert(kind, detail = '') {
    if (typeof alert !== 'function') return;
    const key = kind === 'auth' || kind === 'disabled' ? kind : 'unavailable';
    await alert(key, alertText(key, detail));
  }

  async function once({ method, url, endpoint, body, timeoutMs }) {
    bucket.enter();
    updateBungieStatus({ configured: true, ...bucket.stats() });
    try {
      const response = await doFetch(url, {
        method,
        headers: {
          ...headers(),
          ...(body ? { 'Content-Type': 'application/json' } : {})
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(timeoutMs)
      });
      const contentType = headerMap(response).get('content-type');
      const bodyText = typeof response.text === 'function' ? await response.text() : '';
      if (endpoint === '/Settings/' && !settingsLogged) {
        settingsLogged = true;
        note(`[Nexus Vanguard] bungie /Settings/ status=${response.status} content-type=${contentType || 'missing'}`);
      }
      let json = null;
      if (bodyText && !String(contentType).toLowerCase().includes('html')) {
        try {
          json = JSON.parse(bodyText);
        } catch {
          json = null;
        }
      }
      const classified = classifyResponse({
        status: Number(response.status) || 0,
        contentType,
        bodyText,
        json
      });
      if (classified.throttleSeconds > 0) bucket.pause(endpoint, classified.throttleSeconds);
      if (classified.errorCode && classified.errorCode !== 1) {
        problem(`[Nexus Vanguard] bungie endpoint=${endpoint} error=${classified.errorCode} throttle=${classified.throttleSeconds || 0}`);
      } else if (classified.kind === 'unavailable') {
        problem(`[Nexus Vanguard] bungie endpoint=${endpoint} error=${classified.reason} status=${response.status} throttle=0`);
      }
      return { ...classified, status: Number(response.status) || 0, contentType, json, bodyText: '' };
    } finally {
      bucket.leave();
      updateBungieStatus({ configured: true, ...bucket.stats() });
    }
  }

  async function perform({ method, endpoint, url, body, timeoutMs, retry }) {
    if (!config.configured) return { ok: false, kind: 'unconfigured', reason: 'unconfigured', errorCode: 0 };
    if (stopped) return { ok: false, kind: 'auth', reason: 'api-key', errorCode: 2101 };
    if (!allowed(method, endpoint)) return { ok: false, kind: 'forbidden', reason: 'forbidden', errorCode: 0 };
    if (budgetBlocks(0)) {
      return { ok: false, kind: 'unavailable', reason: 'budget', retry: false, errorCode: 0, throttleSeconds: 0 };
    }
    await bucket.acquire(endpoint);
    return laneLock(endpoint, async () => {
      let last = null;
      const attempts = retry ? MAX_RETRIES : 0;
      for (let attempt = 0; attempt <= attempts; attempt += 1) {
        try {
          last = await once({ method, url, endpoint, body, timeoutMs });
        } catch (error) {
          const timedOut = error?.name === 'TimeoutError' || error?.name === 'AbortError';
          problem(`[Nexus Vanguard] bungie endpoint=${endpoint} error=${timedOut ? 'timeout' : 'network'} throttle=0`);
          last = { kind: 'retry', reason: timedOut ? 'timeout' : 'network', retry: true, errorCode: 0, throttleSeconds: 0, alert: '', status: 0, contentType: '' };
        }
        if (last.kind === 'auth' && last.reason === 'api-key') stopped = true;
        if (last.alert) await sendAlert(last.alert, alertDetail(last));
        if (!last.retry || attempt === attempts) break;
        const delay = Math.min(
          THROTTLE_CAP_SECONDS * 1000,
          Math.max(backoffMs(attempt, roll), (last.throttleSeconds || 0) * 1000)
        );
        if (budgetBlocks(delay)) {
          return { ...last, ok: false, kind: 'unavailable', reason: 'budget', retry: false };
        }
        await wait(delay);
      }
      if (last?.retry) {
        await sendAlert('unavailable', alertDetail(last));
        return { ...last, ok: false, kind: 'unavailable', reason: 'retries', retry: false };
      }
      return { ...last, ok: last?.kind === 'ok' };
    });
  }

  function request(options) {
    const method = options.method || 'GET';
    const endpoint = endpointOf(options.path);
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query || {})) {
      if (value !== undefined && value !== null && String(value) !== '') params.set(key, String(value));
    }
    const query = params.toString();
    const url = `${PLATFORM}${endpoint}${query ? `?${query}` : ''}`;
    const run = () => perform({
      method,
      endpoint,
      url,
      body: options.body,
      timeoutMs: options.timeoutMs || 10000,
      retry: options.retry !== false
    });
    if (method !== 'GET') return run();
    const existing = inflight.get(url);
    if (existing) return existing;
    const promise = run().finally(() => {
      if (inflight.get(url) === promise) inflight.delete(url);
    });
    inflight.set(url, promise);
    return promise;
  }

  async function download(target) {
    const url = contentUrl(target);
    if (!url) return { ok: false, kind: 'forbidden', reason: 'forbidden' };
    if (!config.configured) return { ok: false, kind: 'unconfigured', reason: 'unconfigured' };
    if (stopped) return { ok: false, kind: 'auth', reason: 'api-key' };
    await bucket.acquire('manifest-content');
    bucket.enter();
    try {
      const response = await doFetch(url, {
        method: 'GET',
        headers: headers(),
        signal: AbortSignal.timeout(60000)
      });
      const contentType = headerMap(response).get('content-type');
      if (response.status === 403 || String(contentType).toLowerCase().includes('html')) {
        const detail = response.status === 403 ? 'http-403' : 'html';
        problem(`[Nexus Vanguard] bungie endpoint=manifest-content error=${detail} status=${response.status} throttle=0`);
        await sendAlert('unavailable', detail);
        return { ok: false, kind: 'unavailable', reason: response.status === 403 ? 'http-403' : 'html', status: response.status, contentType };
      }
      if (response.status < 200 || response.status >= 300) {
        return { ok: false, kind: 'error', reason: 'http', status: response.status, contentType };
      }
      return { ok: true, kind: 'ok', status: response.status, contentType, response };
    } finally {
      bucket.leave();
      updateBungieStatus({ configured: true, ...bucket.stats() });
    }
  }

  return {
    config,
    limiter: bucket,
    request,
    get(path, query) {
      return request({ method: 'GET', path, query });
    },
    post(path, body) {
      return request({ method: 'POST', path, body });
    },
    download,
    beginBudget,
    endBudget,
    get stopped() {
      return stopped;
    }
  };
}

module.exports = {
  PLATFORM,
  MAX_RETRIES,
  endpointOf,
  allowed,
  contentUrl,
  redact,
  createBungieClient
};

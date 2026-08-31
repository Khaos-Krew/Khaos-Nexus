'use strict';

const DEFAULT_BASE_URL = 'https://gamecp.citadelservers.com';
const LEGACY_GEN1_SERVICE_ID = '48289';
const ALLOWED_COMMANDS = new Set(['start', 'stop', 'restart']);

function clean(value, max = 300) {
  return String(value ?? '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function prefixName(value = 'ARK_GEN1') {
  const prefix = clean(value, 64).toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,63}$/.test(prefix)) throw new Error('ARK prefix is invalid.');
  return prefix;
}

function baseUrl(env = process.env) {
  const value = String(env.CITADEL_GAMECP_BASE_URL || DEFAULT_BASE_URL).trim().replace(/\/+$/, '');
  if (!/^https:\/\//i.test(value)) throw new Error('Citadel control URL must use HTTPS.');
  return value;
}

function serviceIdFromEnv(prefix = 'ARK_GEN1', env = process.env) {
  prefix = prefixName(prefix);
  const configured = clean(env[`${prefix}_CITADEL_SERVICE_ID`], 32);
  const fallback = prefix === 'ARK_GEN1' ? LEGACY_GEN1_SERVICE_ID : '';
  const value = configured || fallback;
  if (!/^\d{1,20}$/.test(value)) throw new Error(`Citadel service ID is not configured for ${prefix}.`);
  return value;
}

function credentialsFromEnv(prefix = 'ARK_GEN1', env = process.env) {
  prefix = prefixName(prefix);
  const username = String(env[`${prefix}_CITADEL_USERNAME`] || env[`${prefix}_SFTP_USERNAME`] || '').trim();
  const password = String(env[`${prefix}_CITADEL_PASSWORD`] || env[`${prefix}_SFTP_PASSWORD`] || '');
  if (!username || !password) throw new Error(`Citadel credentials are incomplete for ${prefix}.`);
  return { username, password };
}

function setCookies(headers) {
  if (typeof headers?.getSetCookie === 'function') return headers.getSetCookie();
  const raw = headers?.get?.('set-cookie');
  return raw ? [raw] : [];
}

function mergeCookies(jar, additions) {
  const map = new Map();
  for (const part of String(jar || '').split(/;\s*/).filter(Boolean)) {
    const index = part.indexOf('=');
    if (index > 0) map.set(part.slice(0, index), part.slice(index + 1));
  }
  for (const raw of additions || []) {
    const first = String(raw || '').split(';', 1)[0];
    const index = first.indexOf('=');
    if (index > 0) map.set(first.slice(0, index), first.slice(index + 1));
  }
  return [...map].map(([key, value]) => `${key}=${value}`).join('; ');
}

function inputValue(html, name) {
  const escaped = String(name).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tag = String(html || '').match(new RegExp(`<input\\b[^>]*\\bname=["']${escaped}["'][^>]*>`, 'i'))?.[0] || '';
  return tag.match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1] || '';
}

function stripHtml(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

class CitadelControlClient {
  constructor({ prefix = 'ARK_GEN1', env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 20_000 } = {}) {
    this.prefix = prefixName(prefix);
    this.env = env;
    this.fetch = fetchImpl;
    if (typeof this.fetch !== 'function') throw new Error('fetch is unavailable for Citadel control.');
    this.base = baseUrl(env);
    this.serviceId = serviceIdFromEnv(this.prefix, env);
    this.credentials = credentialsFromEnv(this.prefix, env);
    this.timeoutMs = Math.max(5_000, Math.min(Number(timeoutMs) || 20_000, 60_000));
  }

  async request(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    timer.unref?.();
    try {
      return await this.fetch(url, { ...options, signal: controller.signal });
    } catch (error) {
      if (error?.name === 'AbortError') throw new Error(`Citadel request timed out for ${this.prefix}.`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async login() {
    const url = `${this.base}/Login?ReturnUrl=%2F`;
    const initial = await this.request(url, { redirect: 'manual' });
    const html = await initial.text();
    let cookies = mergeCookies('', setCookies(initial.headers));
    const token = inputValue(html, '__RequestVerificationToken');
    if (!token) throw new Error('Citadel login anti-forgery token missing.');
    const body = new URLSearchParams({
      __RequestVerificationToken: token,
      UserName: this.credentials.username,
      Password: this.credentials.password,
      Language: '',
      RememberMe: 'false'
    });
    const encrypted = inputValue(html, '__encrypted_RequireToken');
    if (encrypted) body.set('__encrypted_RequireToken', encrypted);
    const response = await this.request(url, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookies, origin: this.base, referer: url },
      body: body.toString()
    });
    cookies = mergeCookies(cookies, setCookies(response.headers));
    if (!(response.status >= 300 && response.status < 400)) throw new Error(`Citadel login failed (${response.status}).`);
    return cookies;
  }

  async getHome(cookies) {
    const response = await this.request(`${this.base}/Service/Home/${this.serviceId}`, {
      redirect: 'follow',
      headers: { cookie: cookies, referer: `${this.base}/Interface/Game/GameServers` }
    });
    if (response.status >= 400) throw new Error(`Citadel service page failed (${response.status}).`);
    const html = await response.text();
    const text = stripHtml(html);
    const state = text.match(/\bStatus\s+(Running|Stopped|Starting|Stopping|Unknown|Error)\b/i)?.[1]?.toLowerCase() || 'unknown';
    return { html, state, cookies: mergeCookies(cookies, setCookies(response.headers)) };
  }

  async status() {
    const cookies = await this.login();
    const home = await this.getHome(cookies);
    return { ok: true, prefix: this.prefix, serviceId: this.serviceId, state: home.state };
  }

  async command(action) {
    action = clean(action, 20).toLowerCase();
    if (!ALLOWED_COMMANDS.has(action)) throw new Error(`Unsupported Citadel command: ${action || '(missing)'}.`);
    let cookies = await this.login();
    const home = await this.getHome(cookies);
    cookies = home.cookies;
    const token = inputValue(home.html, '__RequestVerificationToken');
    if (!token) throw new Error('Citadel service command anti-forgery token missing.');
    const response = await this.request(`${this.base}/Service/Command/${this.serviceId}`, {
      method: 'POST',
      redirect: 'manual',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        cookie: cookies,
        origin: this.base,
        referer: `${this.base}/Service/Home/${this.serviceId}`
      },
      body: new URLSearchParams({ __RequestVerificationToken: token, Command: action }).toString()
    });
    if (response.status >= 400) throw new Error(`Citadel ${action} command failed (${response.status}).`);
    return {
      ok: true,
      prefix: this.prefix,
      serviceId: this.serviceId,
      action,
      previousState: home.state,
      acceptedStatus: response.status
    };
  }

  restart() { return this.command('restart'); }
  start() { return this.command('start'); }
  stop() { return this.command('stop'); }
}

module.exports = {
  DEFAULT_BASE_URL,
  LEGACY_GEN1_SERVICE_ID,
  ALLOWED_COMMANDS,
  clean,
  prefixName,
  baseUrl,
  serviceIdFromEnv,
  credentialsFromEnv,
  mergeCookies,
  inputValue,
  stripHtml,
  CitadelControlClient
};

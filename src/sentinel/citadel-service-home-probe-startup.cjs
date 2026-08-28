'use strict';

const BASE = 'https://gamecp.citadelservers.com';
const SERVICE_PATH = '/Service/Home/48289';

function safe(value, max = 320) {
  return String(value || '')
    .replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function setCookies(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const raw = headers.get('set-cookie');
  return raw ? [raw] : [];
}

function mergeCookies(jar, additions) {
  const map = new Map();
  for (const part of String(jar || '').split(/;\s*/).filter(Boolean)) {
    const idx = part.indexOf('=');
    if (idx > 0) map.set(part.slice(0, idx), part.slice(idx + 1));
  }
  for (const raw of additions || []) {
    const first = String(raw || '').split(';', 1)[0];
    const idx = first.indexOf('=');
    if (idx > 0) map.set(first.slice(0, idx), first.slice(idx + 1));
  }
  return [...map].map(([k, v]) => `${k}=${v}`).join('; ');
}

function inputValue(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tag = String(html || '').match(new RegExp(`<input\\b[^>]*\\bname=["']${escaped}["'][^>]*>`, 'i'))?.[0] || '';
  return tag.match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1] || '';
}

async function login(signal) {
  const username = String(process.env.ARK_GEN1_SFTP_USERNAME || '').trim();
  const password = String(process.env.ARK_GEN1_SFTP_PASSWORD || '');
  if (!username || !password) throw new Error('credentials-incomplete');

  const loginUrl = `${BASE}/Login?ReturnUrl=%2F`;
  const initial = await fetch(loginUrl, { redirect: 'manual', signal });
  const initialHtml = await initial.text();
  let cookies = mergeCookies('', setCookies(initial.headers));
  const token = inputValue(initialHtml, '__RequestVerificationToken');
  const encrypted = inputValue(initialHtml, '__encrypted_RequireToken');
  if (!token) throw new Error('anti-forgery-token-missing');

  const body = new URLSearchParams({
    __RequestVerificationToken: token,
    UserName: username,
    Password: password,
    Language: '',
    RememberMe: 'false',
  });
  if (encrypted) body.set('__encrypted_RequireToken', encrypted);

  const response = await fetch(loginUrl, {
    method: 'POST',
    redirect: 'manual',
    signal,
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      cookie: cookies,
      origin: BASE,
      referer: loginUrl,
    },
    body: body.toString(),
  });
  cookies = mergeCookies(cookies, setCookies(response.headers));
  if (!(response.status >= 300 && response.status < 400)) throw new Error(`login-${response.status}`);
  return cookies;
}

function strip(html) {
  return safe(String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' '), 2500);
}

function extractForms(html) {
  const forms = [];
  for (const match of String(html || '').matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = match[1] || '';
    const inner = match[2] || '';
    const action = attrs.match(/\baction\s*=\s*["']([^"']*)["']/i)?.[1] || '';
    const method = attrs.match(/\bmethod\s*=\s*["']([^"']*)["']/i)?.[1] || 'get';
    const names = [...inner.matchAll(/<(?:input|select|textarea)\b[^>]*\bname\s*=\s*["']([^"']+)["'][^>]*>/gi)]
      .map((m) => safe(m[1], 120));
    const buttons = [...inner.matchAll(/<(?:button|input)\b[^>]*(?:value\s*=\s*["']([^"']*)["']|>([\s\S]*?)<\/button>)/gi)]
      .map((m) => safe((m[1] || m[2] || '').replace(/<[^>]+>/g, ' '), 120))
      .filter(Boolean);
    forms.push({ action: safe(action, 260), method: safe(method, 20), names: [...new Set(names)].slice(0, 40), buttons: [...new Set(buttons)].slice(0, 30) });
  }
  return forms;
}

function extractRelevantLinks(html) {
  const out = [];
  for (const match of String(html || '').matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = safe(match[1], 280);
    const label = safe(String(match[2] || '').replace(/<[^>]+>/g, ' '), 160);
    if (!href || href.startsWith('javascript:')) continue;
    if (/(48289|start|stop|restart|command|config|setting|service|game|file|mod|api|ark)/i.test(`${href} ${label}`)) out.push({ href, label });
  }
  return out.slice(0, 120);
}

function extractEndpointCandidates(html) {
  const out = new Set();
  for (const match of String(html || '').matchAll(/["'`](\/[^"'`\s<>]{2,400})["'`]/g)) {
    const path = safe(match[1], 360);
    if (/(48289|start|stop|restart|command|config|setting|service|game|file|mod|api|ark)/i.test(path)) out.add(path);
  }
  return [...out].slice(0, 160);
}

function extractKeywordContexts(html) {
  const text = String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ');
  const contexts = [];
  const re = /(ASA API|ArkApi|Ark Server API|AsaApiLoader|ArkAscendedServer|executable|command line|startup|start server|stop server|restart server)/ig;
  let m;
  while ((m = re.exec(text)) && contexts.length < 40) {
    contexts.push(safe(text.slice(Math.max(0, m.index - 140), Math.min(text.length, m.index + 260)), 420));
  }
  return [...new Set(contexts)];
}

async function probe() {
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 25_000);
  timeout.unref?.();
  try {
    const cookies = await login(ctl.signal);
    const response = await fetch(`${BASE}${SERVICE_PATH}`, {
      redirect: 'follow',
      signal: ctl.signal,
      headers: { cookie: cookies, referer: `${BASE}/Interface/Game/GameServers` },
    });
    const html = (await response.text()).slice(0, 5 * 1024 * 1024);
    const links = extractRelevantLinks(html);
    const forms = extractForms(html);
    const endpoints = extractEndpointCandidates(html);
    const contexts = extractKeywordContexts(html);
    console.log(`[Nexus Sentinal] Citadel service 48289 probe: status=${response.status} finalPath=${safe(new URL(response.url).pathname, 260)} bytes=${Buffer.byteLength(html)} links=${links.length} forms=${forms.length} endpoints=${endpoints.length} contexts=${contexts.length}`);
    console.log(`[Nexus Sentinal] Citadel service 48289 text: ${strip(html)}`);
    for (const form of forms) console.log(`[Nexus Sentinal] Citadel service 48289 form: method=${form.method} action=${form.action || '(same-page)'} fields=${form.names.join(',') || '(none)'} buttons=${form.buttons.join(',') || '(none)'}`);
    for (const link of links) console.log(`[Nexus Sentinal] Citadel service 48289 link: ${link.href}${link.label ? ` [${link.label}]` : ''}`);
    for (const endpoint of endpoints) console.log(`[Nexus Sentinal] Citadel service 48289 endpoint: ${endpoint}`);
    for (const context of contexts) console.log(`[Nexus Sentinal] Citadel service 48289 context: ${context}`);
  } catch (error) {
    console.warn(`[Nexus Sentinal] Citadel service 48289 probe failed: ${safe(`${error?.name || 'Error'}:${error?.message || error}`, 500)}`);
  } finally {
    clearTimeout(timeout);
  }
}

const timer = setTimeout(() => void probe(), 5_000);
timer.unref?.();

'use strict';

const BASE = 'https://gamecp.citadelservers.com';

function safe(value, max = 240) {
  return String(value || '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function getSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const one = headers.get('set-cookie'); return one ? [one] : [];
}
function mergeCookies(jar, setCookies) {
  const map = new Map();
  for (const part of String(jar || '').split(/;\s*/).filter(Boolean)) {
    const i = part.indexOf('='); if (i > 0) map.set(part.slice(0, i), part.slice(i + 1));
  }
  for (const raw of setCookies || []) {
    const pair = String(raw || '').split(';', 1)[0]; const i = pair.indexOf('=');
    if (i > 0) map.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return [...map].map(([k, v]) => `${k}=${v}`).join('; ');
}
function inputValue(html, name) {
  const tag = String(html || '').match(new RegExp(`<input\\b[^>]*\\bname=["']${name}["'][^>]*>`, 'i'))?.[0] || '';
  return tag.match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1] || '';
}
function anchors(html) {
  const out = [];
  for (const match of String(html || '').matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = safe(match[1]);
    const label = safe(match[2].replace(/<[^>]+>/g, ' '), 140);
    if (href && !href.startsWith('javascript:')) out.push({ href, label });
  }
  return out;
}
function forms(html) {
  const out = [];
  for (const match of String(html || '').matchAll(/<form\b([^>]*)>/gi)) {
    const attrs = match[1];
    const action = safe(attrs.match(/\baction\s*=\s*["']([^"']*)["']/i)?.[1] || '');
    const method = safe(attrs.match(/\bmethod\s*=\s*["']([^"']*)["']/i)?.[1] || 'get', 20);
    out.push({ action, method });
  }
  return out;
}
async function login(signal) {
  const username = String(process.env.ARK_GEN1_SFTP_USERNAME || '').trim();
  const password = String(process.env.ARK_GEN1_SFTP_PASSWORD || '');
  if (!username || !password) throw new Error('credentials-incomplete');
  const loginUrl = `${BASE}/Login?ReturnUrl=%2F`;
  const first = await fetch(loginUrl, { redirect: 'manual', signal });
  const html = (await first.text()).slice(0, 1024 * 1024);
  let cookies = mergeCookies('', getSetCookies(first.headers));
  const token = inputValue(html, '__RequestVerificationToken');
  const encrypted = inputValue(html, '__encrypted_RequireToken');
  if (!token) throw new Error('anti-forgery-token-missing');
  const body = new URLSearchParams({ __RequestVerificationToken: token, UserName: username, Password: password, Language: '', RememberMe: 'false' });
  if (encrypted) body.set('__encrypted_RequireToken', encrypted);
  const post = await fetch(loginUrl, { method: 'POST', redirect: 'manual', signal, headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookies, origin: BASE, referer: loginUrl }, body: body.toString() });
  cookies = mergeCookies(cookies, getSetCookies(post.headers));
  if (!(post.status >= 300 && post.status < 400)) throw new Error(`login-post-${post.status}`);
  return cookies;
}

async function probe() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 25_000); timeout.unref?.();
  try {
    let cookies = await login(controller.signal);
    const response = await fetch(`${BASE}/Interface/Game/GameServers`, { redirect: 'follow', signal: controller.signal, headers: { cookie: cookies } });
    cookies = mergeCookies(cookies, getSetCookies(response.headers));
    const html = (await response.text()).slice(0, 3 * 1024 * 1024);
    const allAnchors = anchors(html);
    const relevant = allAnchors.filter(({ href, label }) => /(service|server|game|khaos|genesis|gen\s*1)/i.test(`${href} ${label}`)).slice(0, 80);
    const pageForms = forms(html).slice(0, 30);
    console.log(`[Nexus Sentinal] Citadel services probe: status=${response.status} path=${safe(new URL(response.url).pathname)} anchors=${allAnchors.length} relevant=${relevant.length} forms=${pageForms.length}`);
    for (const item of relevant) console.log(`[Nexus Sentinal] Citadel services link: ${item.href}${item.label ? ` [${item.label}]` : ''}`);
    for (const form of pageForms) console.log(`[Nexus Sentinal] Citadel services form: action=${form.action || '(same-page)'} method=${form.method}`);
  } catch (error) {
    console.warn(`[Nexus Sentinal] Citadel services probe failed: ${safe(error?.name || error?.message || error)}`);
  } finally { clearTimeout(timeout); }
}

const timer = setTimeout(() => void probe(), 5_000); timer.unref?.();
module.exports = { anchors, forms };

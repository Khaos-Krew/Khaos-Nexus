'use strict';

const BASE = 'https://gamecp.citadelservers.com';

function safe(value, max = 220) {
  return String(value || '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function getSetCookies(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const one = headers.get('set-cookie');
  return one ? [one] : [];
}

function mergeCookies(jar, setCookies) {
  const map = new Map();
  for (const part of String(jar || '').split(/;\s*/).filter(Boolean)) {
    const index = part.indexOf('=');
    if (index > 0) map.set(part.slice(0, index), part.slice(index + 1));
  }
  for (const raw of setCookies || []) {
    const pair = String(raw || '').split(';', 1)[0];
    const index = pair.indexOf('=');
    if (index > 0) map.set(pair.slice(0, index), pair.slice(index + 1));
  }
  return [...map.entries()].map(([key, value]) => `${key}=${value}`).join('; ');
}

function inputValue(html, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tag = String(html || '').match(new RegExp(`<input\\b[^>]*\\bname=["']${escaped}["'][^>]*>`, 'i'))?.[0] || '';
  return tag.match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1] || '';
}

function loginFormPresent(html) {
  const text = String(html || '');
  return /\bname=["']UserName["']/i.test(text) && /\bname=["']Password["']/i.test(text);
}

function serviceLinks(html) {
  const links = [];
  for (const match of String(html || '').matchAll(/<a\b[^>]*\bhref=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const href = safe(match[1], 240);
    if (!/(service|game|voice)/i.test(href)) continue;
    const label = safe(match[2].replace(/<[^>]+>/g, ' '), 100);
    if (!href || href.startsWith('javascript:')) continue;
    links.push(`${href}${label ? ` [${label}]` : ''}`);
  }
  return [...new Set(links)].slice(0, 30);
}

async function probe() {
  const username = String(process.env.ARK_GEN1_SFTP_USERNAME || '').trim();
  const password = String(process.env.ARK_GEN1_SFTP_PASSWORD || '');
  if (!username || !password) {
    console.log('[Nexus Sentinal] Citadel auth probe: skipped=credentials-incomplete');
    return;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  timeout.unref?.();
  try {
    const loginUrl = `${BASE}/Login?ReturnUrl=%2F`;
    const first = await fetch(loginUrl, {
      method: 'GET', redirect: 'manual', signal: controller.signal,
      headers: { 'user-agent': 'Khaos-Nexus-Sentinel/0.1 Citadel authenticated service probe' }
    });
    const firstHtml = (await first.text()).slice(0, 1024 * 1024);
    let cookies = mergeCookies('', getSetCookies(first.headers));
    const token = inputValue(firstHtml, '__RequestVerificationToken');
    const encryptedRequire = inputValue(firstHtml, '__encrypted_RequireToken');
    if (!token) {
      console.log(`[Nexus Sentinal] Citadel auth probe: success=false stage=form status=${first.status} reason=anti-forgery-token-missing`);
      return;
    }

    const body = new URLSearchParams();
    body.set('__RequestVerificationToken', token);
    if (encryptedRequire) body.set('__encrypted_RequireToken', encryptedRequire);
    body.set('UserName', username);
    body.set('Password', password);
    body.set('Language', '');
    body.set('RememberMe', 'false');

    const post = await fetch(loginUrl, {
      method: 'POST', redirect: 'manual', signal: controller.signal,
      headers: {
        'user-agent': 'Khaos-Nexus-Sentinel/0.1 Citadel authenticated service probe',
        'content-type': 'application/x-www-form-urlencoded',
        'cookie': cookies,
        'origin': BASE,
        'referer': loginUrl
      },
      body: body.toString()
    });
    cookies = mergeCookies(cookies, getSetCookies(post.headers));
    const location = post.headers.get('location') || '';
    let finalStatus = post.status;
    let finalUrl = location ? new URL(location, BASE).toString() : loginUrl;
    let finalHtml = '';

    if (post.status >= 300 && post.status < 400 && location) {
      const next = await fetch(finalUrl, {
        method: 'GET', redirect: 'follow', signal: controller.signal,
        headers: { 'user-agent': 'Khaos-Nexus-Sentinel/0.1 Citadel authenticated service probe', 'cookie': cookies }
      });
      cookies = mergeCookies(cookies, getSetCookies(next.headers));
      finalStatus = next.status;
      finalUrl = next.url;
      finalHtml = (await next.text()).slice(0, 2 * 1024 * 1024);
    } else {
      finalHtml = (await post.text()).slice(0, 2 * 1024 * 1024);
    }

    const loggedIn = finalStatus === 200 && !loginFormPresent(finalHtml) && new URL(finalUrl).host === 'gamecp.citadelservers.com';
    const links = loggedIn ? serviceLinks(finalHtml) : [];
    console.log(`[Nexus Sentinal] Citadel auth probe: success=${loggedIn} postStatus=${post.status} finalStatus=${finalStatus} finalPath=${safe(new URL(finalUrl).pathname, 180)} serviceLinks=${links.length}`);
    for (const link of links) console.log(`[Nexus Sentinal] Citadel service link: ${link}`);
  } catch (error) {
    console.warn(`[Nexus Sentinal] Citadel auth probe failed: ${safe(error?.name || error?.message || error)}`);
  } finally {
    clearTimeout(timeout);
  }
}

const timer = setTimeout(() => void probe(), 5_000);
timer.unref?.();

module.exports = { mergeCookies, inputValue, loginFormPresent, serviceLinks };

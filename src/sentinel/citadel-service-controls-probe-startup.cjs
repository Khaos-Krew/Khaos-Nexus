'use strict';

const BASE = 'https://gamecp.citadelservers.com';
const PATHS = [
  '/Service/CmdLine/48289',
  '/Service/Switcher/48289',
  '/Service/Actions/48289',
  '/Scripts/ServiceManager.js',
  '/Views/Default/Game/Service/_ServiceStatus.js',
];

function safe(value, max = 420) {
  return String(value || '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function setCookies(headers) { if (typeof headers.getSetCookie === 'function') return headers.getSetCookie(); const raw = headers.get('set-cookie'); return raw ? [raw] : []; }
function mergeCookies(jar, additions) { const map = new Map(); for (const part of String(jar || '').split(/;\s*/).filter(Boolean)) { const i = part.indexOf('='); if (i > 0) map.set(part.slice(0, i), part.slice(i + 1)); } for (const raw of additions || []) { const first = String(raw || '').split(';', 1)[0]; const i = first.indexOf('='); if (i > 0) map.set(first.slice(0, i), first.slice(i + 1)); } return [...map].map(([k, v]) => `${k}=${v}`).join('; '); }
function inputValue(html, name) { const e = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const tag = String(html || '').match(new RegExp(`<input\\b[^>]*\\bname=["']${e}["'][^>]*>`, 'i'))?.[0] || ''; return tag.match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1] || ''; }
async function login(signal) { const username = String(process.env.ARK_GEN1_SFTP_USERNAME || '').trim(); const password = String(process.env.ARK_GEN1_SFTP_PASSWORD || ''); if (!username || !password) throw new Error('credentials-incomplete'); const url = `${BASE}/Login?ReturnUrl=%2F`; const g = await fetch(url, { redirect: 'manual', signal }); const h = await g.text(); let cookies = mergeCookies('', setCookies(g.headers)); const token = inputValue(h, '__RequestVerificationToken'); const encrypted = inputValue(h, '__encrypted_RequireToken'); if (!token) throw new Error('token-missing'); const body = new URLSearchParams({ __RequestVerificationToken: token, UserName: username, Password: password, Language: '', RememberMe: 'false' }); if (encrypted) body.set('__encrypted_RequireToken', encrypted); const r = await fetch(url, { method: 'POST', redirect: 'manual', signal, headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookies, origin: BASE, referer: url }, body: body.toString() }); cookies = mergeCookies(cookies, setCookies(r.headers)); if (!(r.status >= 300 && r.status < 400)) throw new Error(`login-${r.status}`); return cookies; }

function attr(tag, name) { const m = String(tag || '').match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i')); return m?.[1] || ''; }
function sanitizeValue(name, type, value) { if (!value) return ''; if (/token|password|secret|key|cookie/i.test(name)) return '[redacted]'; if (type === 'hidden' && !/command|action|service|game|template|profile|id|type|mode|launcher|exe|executable/i.test(name)) return '[hidden]'; return safe(value, 220); }
function forms(html) {
  const out = [];
  for (const m of String(html || '').matchAll(/<form\b([^>]*)>([\s\S]*?)<\/form>/gi)) {
    const attrs = m[1] || '', inner = m[2] || '';
    const fields = [];
    for (const im of inner.matchAll(/<input\b[^>]*>/gi)) { const tag = im[0]; const name = attr(tag, 'name'); const type = (attr(tag, 'type') || 'text').toLowerCase(); const value = sanitizeValue(name, type, attr(tag, 'value')); if (name) fields.push(`${name}:${type}${value ? `=${value}` : ''}`); }
    for (const sm of inner.matchAll(/<select\b[^>]*\bname=["']([^"']+)["'][^>]*>([\s\S]*?)<\/select>/gi)) { const name = safe(sm[1], 100); const opts = [...String(sm[2] || '').matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/gi)].map((om) => { const v = safe(attr(om[1], 'value'), 120); const label = safe(String(om[2] || '').replace(/<[^>]+>/g, ' '), 120); const selected = /\bselected\b/i.test(om[1] || '') ? '*' : ''; return `${selected}${v}:${label}`; }).slice(0, 30); fields.push(`${name}:select=[${opts.join('|')}]`); }
    const buttons = [...inner.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/gi)].map((bm) => `${safe(attr(bm[1], 'name'), 80)}=${safe(attr(bm[1], 'value'), 100)}:${safe(String(bm[2] || '').replace(/<[^>]+>/g, ' '), 120)}`).slice(0, 30);
    out.push({ method: safe(attr(attrs, 'method') || 'get', 20), action: safe(attr(attrs, 'action') || '(same-page)', 260), fields: [...new Set(fields)].slice(0, 60), buttons: [...new Set(buttons)].slice(0, 30) });
  }
  return out;
}
function keywordContexts(text) { const clean = String(text || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' '); const terms = /(ASA API|ArkApi|AsaApiLoader|ArkAscendedServer|executable|command line|commandline|startup|launcher|start|stop|restart|switcher|profile)/ig; const out = []; let m; while ((m = terms.exec(clean)) && out.length < 80) out.push(safe(clean.slice(Math.max(0, m.index - 180), Math.min(clean.length, m.index + 420)), 600)); return [...new Set(out)]; }
function scriptContexts(text) { const clean = String(text || ''); const re = /(Service\/Command|Command\s*[:=]|Start|Stop|Restart|Kill|Actions|CmdLine|Switcher|48289)/ig; const out=[]; let m; while ((m=re.exec(clean)) && out.length<100) out.push(safe(clean.slice(Math.max(0,m.index-220),Math.min(clean.length,m.index+500)),720)); return [...new Set(out)]; }

async function probe() { const ctl = new AbortController(); const timeout = setTimeout(() => ctl.abort(), 30_000); timeout.unref?.(); try { const cookies = await login(ctl.signal); for (const path of PATHS) { try { const r = await fetch(`${BASE}${path}`, { redirect: 'follow', signal: ctl.signal, headers: { cookie: cookies, referer: `${BASE}/Service/Home/48289` } }); const text = (await r.text()).slice(0, 5 * 1024 * 1024); console.log(`[Nexus Sentinal] Citadel control probe: path=${path} status=${r.status} finalPath=${safe(new URL(r.url).pathname,260)} bytes=${Buffer.byteLength(text)}`); if (/\.js(?:\?|$)/i.test(path)) { for (const c of scriptContexts(text)) console.log(`[Nexus Sentinal] Citadel control script context: path=${path} ${c}`); } else { for (const f of forms(text)) console.log(`[Nexus Sentinal] Citadel control form: path=${path} method=${f.method} action=${f.action} fields=${f.fields.join(',') || '(none)'} buttons=${f.buttons.join(',') || '(none)'}`); for (const c of keywordContexts(text)) console.log(`[Nexus Sentinal] Citadel control context: path=${path} ${c}`); } } catch (e) { console.warn(`[Nexus Sentinal] Citadel control path failed: path=${path} error=${safe(`${e?.name || 'Error'}:${e?.message || e}`,500)}`); } } } catch (e) { console.warn(`[Nexus Sentinal] Citadel control probe failed: ${safe(`${e?.name || 'Error'}:${e?.message || e}`,500)}`); } finally { clearTimeout(timeout); } }
const timer = setTimeout(() => void probe(), 5_000); timer.unref?.();

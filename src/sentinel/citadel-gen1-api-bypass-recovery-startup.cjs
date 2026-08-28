'use strict';

const fs = require('node:fs');
const path = require('node:path');
const SftpClient = require('ssh2-sftp-client');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');
const { sftpSettingsFromEnv, remotePath } = require('./ark-sftp-config.cjs');

const BASE = 'https://gamecp.citadelservers.com';
const SERVICE_ID = 48289;
const STAMP = '/app/data/ark-gen1-api-bypass-v1.done.json';
const WIN64 = 'ShooterGame/Binaries/Win64';
const SERVER_EXE = `${WIN64}/ArkAscendedServer.exe`;
const LOADER_EXE = `${WIN64}/AsaApiLoader.exe`;
const BACKUP_EXE = `${WIN64}/AsaApiLoader.exe.nexus-original-api-loader.bak`;

function safe(value, max = 420) {
  return String(value || '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}
function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function setCookies(headers) { if (typeof headers.getSetCookie === 'function') return headers.getSetCookie(); const raw = headers.get('set-cookie'); return raw ? [raw] : []; }
function mergeCookies(jar, additions) { const map = new Map(); for (const part of String(jar || '').split(/;\s*/).filter(Boolean)) { const i = part.indexOf('='); if (i > 0) map.set(part.slice(0, i), part.slice(i + 1)); } for (const raw of additions || []) { const first = String(raw || '').split(';', 1)[0]; const i = first.indexOf('='); if (i > 0) map.set(first.slice(0, i), first.slice(i + 1)); } return [...map].map(([k, v]) => `${k}=${v}`).join('; '); }
function inputValue(html, name) { const e = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const tag = String(html || '').match(new RegExp(`<input\\b[^>]*\\bname=["']${e}["'][^>]*>`, 'i'))?.[0] || ''; return tag.match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1] || ''; }
function strip(html) { return String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim(); }

async function login(signal) {
  const username = String(process.env.ARK_GEN1_SFTP_USERNAME || '').trim();
  const password = String(process.env.ARK_GEN1_SFTP_PASSWORD || '');
  if (!username || !password) throw new Error('Citadel credentials are incomplete.');
  const url = `${BASE}/Login?ReturnUrl=%2F`;
  const initial = await fetch(url, { redirect: 'manual', signal });
  const html = await initial.text();
  let cookies = mergeCookies('', setCookies(initial.headers));
  const token = inputValue(html, '__RequestVerificationToken');
  const encrypted = inputValue(html, '__encrypted_RequireToken');
  if (!token) throw new Error('Citadel anti-forgery token missing.');
  const body = new URLSearchParams({ __RequestVerificationToken: token, UserName: username, Password: password, Language: '', RememberMe: 'false' });
  if (encrypted) body.set('__encrypted_RequireToken', encrypted);
  const response = await fetch(url, { method: 'POST', redirect: 'manual', signal, headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookies, origin: BASE, referer: url }, body: body.toString() });
  cookies = mergeCookies(cookies, setCookies(response.headers));
  if (!(response.status >= 300 && response.status < 400)) throw new Error(`Citadel login failed (${response.status}).`);
  return cookies;
}

async function getHome(cookies, signal) {
  const response = await fetch(`${BASE}/Service/Home/${SERVICE_ID}`, { redirect: 'follow', signal, headers: { cookie: cookies, referer: `${BASE}/Interface/Game/GameServers` } });
  const html = await response.text();
  const nextCookies = mergeCookies(cookies, setCookies(response.headers));
  const text = strip(html);
  let state = 'unknown';
  const match = text.match(/\bStatus\s+(Running|Stopped|Starting|Stopping|Unknown|Error)\b/i);
  if (match) state = match[1].toLowerCase();
  return { html, text, state, cookies: nextCookies, status: response.status };
}

async function command(cookies, action, signal) {
  const home = await getHome(cookies, signal);
  const token = inputValue(home.html, '__RequestVerificationToken');
  if (!token) throw new Error('Citadel service command anti-forgery token missing.');
  const body = new URLSearchParams({ __RequestVerificationToken: token, Command: action });
  const response = await fetch(`${BASE}/Service/Command/${SERVICE_ID}`, {
    method: 'POST', redirect: 'manual', signal,
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: home.cookies, origin: BASE, referer: `${BASE}/Service/Home/${SERVICE_ID}` },
    body: body.toString(),
  });
  const nextCookies = mergeCookies(home.cookies, setCookies(response.headers));
  console.log(`[Nexus Sentinal] Gen 1 recovery Citadel command: action=${action} status=${response.status}`);
  if (response.status >= 400) throw new Error(`Citadel ${action} command failed (${response.status}).`);
  return nextCookies;
}

async function waitState(cookies, wanted, timeoutMs, signal) {
  const deadline = Date.now() + timeoutMs;
  let jar = cookies;
  let last = 'unknown';
  while (Date.now() < deadline) {
    const home = await getHome(jar, signal);
    jar = home.cookies;
    last = home.state;
    console.log(`[Nexus Sentinal] Gen 1 recovery Citadel state: ${last}`);
    if (last === wanted) return jar;
    await sleep(5000);
  }
  throw new Error(`Citadel service did not reach ${wanted}; last state=${last}.`);
}

async function statOrNull(client, remote) {
  try { return await client.stat(remote); } catch (error) { if (/no such|not found|failure/i.test(String(error?.message || error))) return null; throw error; }
}

async function stageBypass() {
  const settings = sftpSettingsFromEnv('ARK_GEN1');
  const serverExe = remotePath(settings.root, SERVER_EXE);
  const loaderExe = remotePath(settings.root, LOADER_EXE);
  const backupExe = remotePath(settings.root, BACKUP_EXE);
  const client = new SftpClient('khaos-nexus-gen1-api-bypass');
  const tmp = path.join('/tmp', `nexus-ark-server-${process.pid}-${Date.now()}.exe`);
  let renamedCurrent = null;
  try {
    await client.connect({ host: settings.host, port: settings.port, username: settings.username, password: settings.password, readyTimeout: settings.readyTimeout || 12000 });
    const serverStat = await client.stat(serverExe);
    if (!serverStat || !Number(serverStat.size)) throw new Error('ArkAscendedServer.exe is unavailable or empty.');
    if (Number(serverStat.size) > 2_000_000_000) throw new Error(`ArkAscendedServer.exe is unexpectedly large (${serverStat.size} bytes).`);
    let loaderStat = await statOrNull(client, loaderExe);
    let backupStat = await statOrNull(client, backupExe);
    console.log(`[Nexus Sentinal] Gen 1 recovery files: serverBytes=${serverStat.size} loaderBytes=${loaderStat?.size || 0} backupExists=${Boolean(backupStat)}`);

    if (!backupStat) {
      if (!loaderStat) throw new Error('AsaApiLoader.exe is missing before backup could be created.');
      await client.rename(loaderExe, backupExe);
      backupStat = await client.stat(backupExe);
      loaderStat = null;
      console.log(`[Nexus Sentinal] Gen 1 recovery: original ASA API loader backed up at ${backupExe}`);
    } else if (loaderStat && Number(loaderStat.size) !== Number(serverStat.size)) {
      const suffix = new Date().toISOString().replace(/[:.]/g, '-');
      renamedCurrent = `${loaderExe}.nexus-replaced-${suffix}.bak`;
      await client.rename(loaderExe, renamedCurrent);
      loaderStat = null;
      console.log(`[Nexus Sentinal] Gen 1 recovery: preserved current loader variant at ${renamedCurrent}`);
    }

    if (!loaderStat || Number(loaderStat.size) !== Number(serverStat.size)) {
      console.log(`[Nexus Sentinal] Gen 1 recovery: downloading normal ARK executable for loader-path bypass (${serverStat.size} bytes)`);
      await client.fastGet(serverExe, tmp);
      const localStat = fs.statSync(tmp);
      if (Number(localStat.size) !== Number(serverStat.size)) throw new Error(`Downloaded ARK executable size mismatch (${localStat.size} != ${serverStat.size}).`);
      console.log('[Nexus Sentinal] Gen 1 recovery: uploading normal ARK executable to Citadel loader path');
      await client.fastPut(tmp, loaderExe);
    }

    const verify = await client.stat(loaderExe);
    if (Number(verify.size) !== Number(serverStat.size)) throw new Error(`Loader-path bypass verification failed (${verify.size} != ${serverStat.size}).`);
    console.log(`[Nexus Sentinal] Gen 1 recovery: ASA API loader bypass staged successfully loaderBytes=${verify.size}`);
    return { serverExe, loaderExe, backupExe, serverBytes: Number(serverStat.size), bypassBytes: Number(verify.size) };
  } catch (error) {
    console.warn(`[Nexus Sentinal] Gen 1 recovery staging failed: ${safe(error?.message || error)}`);
    try {
      const loaderNow = await statOrNull(client, loaderExe);
      const backupNow = await statOrNull(client, backupExe);
      if (!loaderNow && backupNow) {
        await client.rename(backupExe, loaderExe);
        console.warn('[Nexus Sentinal] Gen 1 recovery: restored original ASA API loader after staging failure.');
      }
    } catch (restoreError) {
      console.warn(`[Nexus Sentinal] Gen 1 recovery loader restore failed: ${safe(restoreError?.message || restoreError)}`);
    }
    throw error;
  } finally {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch {}
    await client.end().catch(() => {});
  }
}

async function waitForRcon(timeoutMs = 12 * 60 * 1000) {
  const server = arkServerFromEnv('ARK_GEN1');
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;
  let lastError = '';
  while (Date.now() < deadline) {
    attempt += 1;
    try {
      const client = new ArkRconClient({ host: server.host, port: server.port, password: server.password, timeoutMs: 8000 });
      const response = await client.execute('ListPlayers');
      console.log(`[Nexus Sentinal] Gen 1 recovery RCON online: attempt=${attempt} responseBytes=${Buffer.byteLength(String(response || ''))}`);
      return true;
    } catch (error) {
      lastError = safe(error?.message || error, 220);
      if (attempt === 1 || attempt % 4 === 0) console.log(`[Nexus Sentinal] Gen 1 recovery waiting for RCON: attempt=${attempt} last=${lastError}`);
    }
    await sleep(15000);
  }
  throw new Error(`ARK RCON did not come online after bypass; last=${lastError}`);
}

async function recover() {
  if (fs.existsSync(STAMP)) {
    console.log(`[Nexus Sentinal] Gen 1 API bypass recovery skipped: already completed (${STAMP})`);
    return;
  }
  const ctl = new AbortController();
  const overall = setTimeout(() => ctl.abort(), 20 * 60 * 1000);
  try {
    let cookies = await login(ctl.signal);
    const initial = await getHome(cookies, ctl.signal);
    cookies = initial.cookies;
    console.log(`[Nexus Sentinal] Gen 1 recovery starting: Citadel state=${initial.state}`);

    if (initial.state !== 'stopped') {
      cookies = await command(cookies, 'stop', ctl.signal);
      cookies = await waitState(cookies, 'stopped', 120000, ctl.signal);
    }

    const staged = await stageBypass();
    cookies = await command(cookies, 'start', ctl.signal);
    cookies = await waitState(cookies, 'running', 120000, ctl.signal);
    await waitForRcon();

    fs.mkdirSync(path.dirname(STAMP), { recursive: true });
    fs.writeFileSync(STAMP, JSON.stringify({ completedAt: new Date().toISOString(), serviceId: SERVICE_ID, mode: 'api-loader-bypass', backup: staged.backupExe, loaderPath: staged.loaderExe, serverBytes: staged.serverBytes }, null, 2));
    console.log(`[Nexus Sentinal] Gen 1 recovery COMPLETE: ARK is RCON-responsive with ASA API loader bypassed. Original loader backup=${staged.backupExe}`);
  } catch (error) {
    console.error(`[Nexus Sentinal] Gen 1 recovery FAILED: ${safe(`${error?.name || 'Error'}:${error?.message || error}`, 600)}`);
    try {
      let cookies = await login(ctl.signal);
      const home = await getHome(cookies, ctl.signal);
      if (home.state === 'stopped') {
        cookies = await command(home.cookies, 'start', ctl.signal);
        console.warn('[Nexus Sentinal] Gen 1 recovery fallback: requested server start after failure.');
      }
    } catch (fallbackError) {
      console.warn(`[Nexus Sentinal] Gen 1 recovery fallback start failed: ${safe(fallbackError?.message || fallbackError)}`);
    }
  } finally {
    clearTimeout(overall);
  }
}

setTimeout(() => void recover(), 8000);

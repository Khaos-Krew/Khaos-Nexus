'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const SftpClient = require('ssh2-sftp-client');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');
const { sftpSettingsFromEnv, remotePath } = require('./ark-sftp-config.cjs');
const { inspectArkApiLog } = require('./ark-api-log-diagnostic.cjs');
const { sqliteStatus } = require('./arkshop-sqlite.cjs');

const BASE = 'https://gamecp.citadelservers.com';
const SERVICE_ID = 48289;
const SERVICE_ROOT = '72.46.128.202_8080';
const MAX_BACKUP_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_BACKUP_FILES = 5000;

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function clean(value, max = 420) { return String(value || '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max); }
function setCookies(headers) { if (typeof headers.getSetCookie === 'function') return headers.getSetCookie(); const raw = headers.get('set-cookie'); return raw ? [raw] : []; }
function mergeCookies(jar, additions) { const map = new Map(); for (const part of String(jar || '').split(/;\s*/).filter(Boolean)) { const i = part.indexOf('='); if (i > 0) map.set(part.slice(0, i), part.slice(i + 1)); } for (const raw of additions || []) { const first = String(raw || '').split(';', 1)[0]; const i = first.indexOf('='); if (i > 0) map.set(first.slice(0, i), first.slice(i + 1)); } return [...map].map(([key, value]) => `${key}=${value}`).join('; '); }
function inputValue(html, name) { const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); const tag = String(html || '').match(new RegExp(`<input\\b[^>]*\\bname=["']${escaped}["'][^>]*>`, 'i'))?.[0] || ''; return tag.match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1] || ''; }
function strip(html) { return String(html || '').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/\s+/g, ' ').trim(); }
function isDirectory(entry) { return entry && (entry.type === 'd' || String(entry.permissions || '').startsWith('d')); }
function safeRequest(value) { const request = String(value || '').trim(); if (!/^[A-Za-z0-9._-]{6,80}$/.test(request)) throw new Error('Controlled API test request token is invalid.'); return request; }

async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(file);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', resolve);
  });
  return hash.digest('hex');
}

async function login(signal) {
  const username = String(process.env.ARK_GEN1_SFTP_USERNAME || '').trim();
  const password = String(process.env.ARK_GEN1_SFTP_PASSWORD || '');
  if (!username || !password) throw new Error('Citadel credentials are incomplete.');
  const url = `${BASE}/Login?ReturnUrl=%2F`;
  const initial = await fetch(url, { redirect: 'manual', signal });
  const html = await initial.text();
  let cookies = mergeCookies('', setCookies(initial.headers));
  const token = inputValue(html, '__RequestVerificationToken');
  if (!token) throw new Error('Citadel anti-forgery token missing.');
  const body = new URLSearchParams({ __RequestVerificationToken: token, UserName: username, Password: password, Language: '', RememberMe: 'false' });
  const encrypted = inputValue(html, '__encrypted_RequireToken');
  if (encrypted) body.set('__encrypted_RequireToken', encrypted);
  const response = await fetch(url, { method: 'POST', redirect: 'manual', signal, headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: cookies, origin: BASE, referer: url }, body: body.toString() });
  cookies = mergeCookies(cookies, setCookies(response.headers));
  if (!(response.status >= 300 && response.status < 400)) throw new Error(`Citadel login failed (${response.status}).`);
  return cookies;
}

async function getHome(cookies, signal) {
  const response = await fetch(`${BASE}/Service/Home/${SERVICE_ID}`, { redirect: 'follow', signal, headers: { cookie: cookies, referer: `${BASE}/Interface/Game/GameServers` } });
  const html = await response.text();
  const text = strip(html);
  const state = text.match(/\bStatus\s+(Running|Stopped|Starting|Stopping|Unknown|Error)\b/i)?.[1]?.toLowerCase() || 'unknown';
  return { html, state, cookies: mergeCookies(cookies, setCookies(response.headers)) };
}

async function command(cookies, action, signal) {
  const home = await getHome(cookies, signal);
  const token = inputValue(home.html, '__RequestVerificationToken');
  if (!token) throw new Error('Citadel service command anti-forgery token missing.');
  const response = await fetch(`${BASE}/Service/Command/${SERVICE_ID}`, { method: 'POST', redirect: 'manual', signal, headers: { 'content-type': 'application/x-www-form-urlencoded', cookie: home.cookies, origin: BASE, referer: `${BASE}/Service/Home/${SERVICE_ID}` }, body: new URLSearchParams({ __RequestVerificationToken: token, Command: action }).toString() });
  if (response.status >= 400) throw new Error(`Citadel ${action} command failed (${response.status}).`);
  console.log(`[Nexus Sentinal] Controlled API test Citadel command accepted: ${action} (${response.status})`);
  return mergeCookies(home.cookies, setCookies(response.headers));
}

async function waitState(cookies, wanted, timeoutMs, signal) {
  const deadline = Date.now() + timeoutMs;
  let jar = cookies;
  let last = 'unknown';
  while (Date.now() < deadline) {
    const home = await getHome(jar, signal);
    jar = home.cookies;
    last = home.state;
    if (last === wanted) return jar;
    await sleep(5000);
  }
  throw new Error(`Citadel service did not reach ${wanted}; last=${last}.`);
}

function rcon() {
  const server = arkServerFromEnv('ARK_GEN1');
  return new ArkRconClient({ host: server.host, port: server.port, password: server.password, timeoutMs: 8000 });
}

function noPlayers(response) {
  const value = String(response || '').trim();
  return !value || /no players connected/i.test(value);
}

async function requireEmptyServer(stage) {
  const response = await rcon().execute('ListPlayers');
  if (!noPlayers(response)) throw new Error(`Controlled API test stopped at ${stage}: players are connected.`);
  console.log(`[Nexus Sentinal] Controlled API test empty-server check passed: ${stage}`);
}

async function connectSftp() {
  const settings = sftpSettingsFromEnv('ARK_GEN1');
  const client = new SftpClient('khaos-nexus-controlled-api-test');
  await client.connect({ host: settings.host, port: settings.port, username: settings.username, password: settings.password, readyTimeout: settings.readyTimeout || 12000 });
  return { client, settings: { ...settings, root: settings.root || SERVICE_ROOT } };
}

async function listFiles(client, base) {
  const files = [];
  const queue = [{ remote: base, relative: '' }];
  while (queue.length) {
    const current = queue.shift();
    for (const entry of await client.list(current.remote)) {
      const relative = current.relative ? `${current.relative}/${entry.name}` : entry.name;
      const remote = `${current.remote}/${entry.name}`;
      if (isDirectory(entry)) queue.push({ remote, relative });
      else files.push({ remote, relative, size: Number(entry.size) || 0, modifyTime: Number(entry.modifyTime) || 0 });
      if (files.length > MAX_BACKUP_FILES) throw new Error(`Save backup exceeds ${MAX_BACKUP_FILES} files.`);
    }
  }
  const bytes = files.reduce((sum, file) => sum + file.size, 0);
  if (!files.length) throw new Error('No ARK save files were found to back up.');
  if (bytes > MAX_BACKUP_BYTES) throw new Error(`Save backup exceeds ${MAX_BACKUP_BYTES} bytes.`);
  return { files, bytes };
}

async function downloadSaveBackup(requestDirectory) {
  const { client, settings } = await connectSftp();
  const remoteDirectory = remotePath(settings.root, 'ShooterGame/Saved/SavedArks');
  const localDirectory = path.join(requestDirectory, 'SavedArks');
  fs.mkdirSync(localDirectory, { recursive: true });
  try {
    const inventory = await listFiles(client, remoteDirectory);
    for (const file of inventory.files) {
      const local = path.join(localDirectory, ...file.relative.split('/'));
      fs.mkdirSync(path.dirname(local), { recursive: true });
      await client.fastGet(file.remote, local);
      const localStat = fs.statSync(local);
      const after = await client.stat(file.remote);
      if (Number(localStat.size) !== file.size || Number(after.size) !== file.size || Number(after.modifyTime || 0) !== file.modifyTime) throw new Error(`Save file changed during backup: ${file.relative}`);
      file.sha256 = await sha256File(local);
    }
    fs.writeFileSync(path.join(requestDirectory, 'save-manifest.json'), JSON.stringify({ createdAt: new Date().toISOString(), remoteDirectory, bytes: inventory.bytes, files: inventory.files }, null, 2));
    console.log(`[Nexus Sentinal] Controlled API test pre-restart save backup verified: files=${inventory.files.length} bytes=${inventory.bytes}`);
    return { remoteDirectory, localDirectory, ...inventory };
  } finally {
    await client.end().catch(() => {});
  }
}

async function restoreSaveBackup(requestDirectory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(requestDirectory, 'save-manifest.json'), 'utf8'));
  const { client } = await connectSftp();
  try {
    for (const file of manifest.files) {
      const local = path.join(requestDirectory, 'SavedArks', ...file.relative.split('/'));
      const hash = await sha256File(local);
      if (hash !== file.sha256) throw new Error(`Local rollback backup hash mismatch: ${file.relative}`);
      const remote = `${manifest.remoteDirectory}/${file.relative}`;
      await client.mkdir(path.posix.dirname(remote), true);
      await client.fastPut(local, remote);
      const after = await client.stat(remote);
      if (Number(after.size) !== Number(file.size)) throw new Error(`Rollback upload verification failed: ${file.relative}`);
    }
    console.warn(`[Nexus Sentinal] Controlled API test save rollback restored: files=${manifest.files.length} bytes=${manifest.bytes}`);
  } finally {
    await client.end().catch(() => {});
  }
}

async function disableApiLoader(request) {
  const { client, settings } = await connectSftp();
  const win64 = remotePath(settings.root, 'ShooterGame/Binaries/Win64');
  const loader = `${win64}/AsaApiLoader.exe`;
  const server = `${win64}/ArkAscendedServer.exe`;
  const preserved = `${loader}.nexus-failed-test-${request}.bak`;
  const directory = path.join(process.env.NEXUS_DATA_DIR || '/app/data', 'controlled-api-tests', request);
  const loaderLocal = path.join(directory, 'AsaApiLoader.pre-failure.exe');
  const serverLocal = path.join(directory, 'ArkAscendedServer.normal.exe');
  try {
    const loaderStat = await client.stat(loader);
    const serverStat = await client.stat(server);
    await client.fastGet(loader, loaderLocal);
    await client.fastPut(loaderLocal, preserved);
    await client.fastGet(server, serverLocal);
    if (fs.statSync(serverLocal).size !== Number(serverStat.size)) throw new Error('Normal ARK executable backup size mismatch.');
    await client.fastPut(serverLocal, loader);
    const after = await client.stat(loader);
    if (Number(after.size) !== Number(serverStat.size)) throw new Error('ASA API disable verification failed.');
    console.warn(`[Nexus Sentinal] Controlled API test disabled ASA API loader; failed loader preserved at ${preserved}`);
  } finally {
    await client.end().catch(() => {});
  }
}

async function waitRconOffline(timeoutMs = 180000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try { await rcon().execute('ListPlayers'); } catch { return true; }
    await sleep(5000);
  }
  throw new Error('ARK never went offline during the controlled restart.');
}

async function waitRconOnline(timeoutMs = 15 * 60 * 1000) {
  const deadline = Date.now() + timeoutMs;
  let last = '';
  while (Date.now() < deadline) {
    try { return await rcon().execute('ListPlayers'); } catch (error) { last = clean(error?.message || error, 220); }
    await sleep(15000);
  }
  throw new Error(`ARK RCON did not recover after restart: ${last}`);
}

async function validateApiStartup() {
  await sleep(45000);
  const diagnostic = await inspectArkApiLog('ARK_GEN1');
  const lifecycle = (diagnostic.lifecycle || []).join('\n');
  const issues = (diagnostic.issues || []).join('\n');
  const readiness = diagnostic.newest?.readiness || diagnostic.readiness || {};
  const required = [
    [/api was successfully loaded/i, 'ASA API loader'],
    [/loaded all plugins/i, 'plugin completion'],
    [/permissions/i, 'Permissions plugin'],
    [/arkshop/i, 'ArkShop plugin']
  ];
  const missing = required.filter(([matcher]) => !matcher.test(lifecycle)).map(([, label]) => label);
  if (!readiness.advertising || !readiness.fullStartup) missing.push('full advertising startup');
  if (/failed to get the offset|fatal error|access violation/i.test(issues)) missing.push('clean API startup');
  const database = await sqliteStatus('ARK_GEN1');
  if (!database.connected || !database.tableExists) missing.push('ArkShop SQLite Players table');
  if (missing.length) throw new Error(`Post-restart API validation failed: ${[...new Set(missing)].join(', ')}`);
  console.log(`[Nexus Sentinal] Controlled API test PASSED: ASA API, Permissions, ArkShop, ArkShopUI path, SQLite and RCON recovered cleanly.`);
  return { source: diagnostic.source, readiness, lifecycle: diagnostic.lifecycle, sqlite: { connected: database.connected, table: database.table, tableExists: database.tableExists } };
}

async function runControlledApiRestartTest(requestValue) {
  const request = safeRequest(requestValue);
  const baseDirectory = process.env.NEXUS_DATA_DIR || '/app/data';
  const requestDirectory = path.join(baseDirectory, 'controlled-api-tests', request);
  const reportFile = path.join(requestDirectory, 'report.json');
  const activeFile = path.join(requestDirectory, 'active.json');
  if (fs.existsSync(reportFile)) {
    console.log(`[Nexus Sentinal] Controlled API test skipped: completed request ${request}`);
    return JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  }
  fs.mkdirSync(requestDirectory, { recursive: true });
  if (fs.existsSync(activeFile)) {
    console.error(`[Nexus Sentinal] Controlled API test will not repeat an interrupted request automatically: ${request}`);
    return { request, status: 'interrupted-needs-attention' };
  }
  fs.writeFileSync(activeFile, JSON.stringify({ request, startedAt: new Date().toISOString(), processId: process.pid }, null, 2), { flag: 'wx' });
  const ctl = new AbortController();
  const timeout = setTimeout(() => ctl.abort(), 40 * 60 * 1000);
  const report = { request, startedAt: new Date().toISOString(), status: 'running', restartIssued: false, rollback: false };
  try {
    await requireEmptyServer('before backup');
    await rcon().execute('SaveWorld');
    await sleep(15000);
    const backup = await downloadSaveBackup(requestDirectory);
    report.backup = { files: backup.files.length, bytes: backup.bytes, directory: requestDirectory };
    await requireEmptyServer('immediately before restart');
    await rcon().execute('SaveWorld');
    await sleep(8000);
    let cookies = await login(ctl.signal);
    cookies = await command(cookies, 'restart', ctl.signal);
    report.restartIssued = true;
    await waitRconOffline();
    await waitRconOnline();
    report.validation = await validateApiStartup();
    report.status = 'passed';
  } catch (error) {
    report.error = clean(error?.message || error, 700);
    console.error(`[Nexus Sentinal] Controlled API test FAILED: ${report.error}`);
    if (report.restartIssued) {
      try {
        let cookies = await login(ctl.signal);
        const home = await getHome(cookies, ctl.signal);
        cookies = home.cookies;
        if (home.state !== 'stopped') {
          cookies = await command(cookies, 'stop', ctl.signal);
          cookies = await waitState(cookies, 'stopped', 180000, ctl.signal);
        }
        await restoreSaveBackup(requestDirectory);
        await disableApiLoader(request);
        cookies = await command(cookies, 'start', ctl.signal);
        await waitRconOnline();
        report.rollback = true;
        report.status = 'failed-rolled-back-api-disabled';
        console.warn('[Nexus Sentinal] Controlled API test rollback COMPLETE: pre-test save restored, ASA API disabled, base ARK server RCON-responsive.');
      } catch (rollbackError) {
        report.rollbackError = clean(rollbackError?.message || rollbackError, 700);
        report.status = 'rollback-failed-needs-attention';
        console.error(`[Nexus Sentinal] Controlled API test rollback FAILED: ${report.rollbackError}`);
      }
    } else {
      report.status = 'aborted-before-restart';
    }
  } finally {
    clearTimeout(timeout);
    report.completedAt = new Date().toISOString();
    fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
    fs.rmSync(activeFile, { force: true });
  }
  return report;
}

module.exports = { noPlayers, safeRequest, runControlledApiRestartTest };

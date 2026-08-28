'use strict';

const path = require('node:path');
const SftpClient = require('ssh2-sftp-client');
const { sftpSettingsFromEnv } = require('./ark-sftp-config.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');

const PREFIX = 'ARK_GEN1';
const JSON_URL = 'https://raw.githubusercontent.com/Khaos-Krew/Khaos-Nexus/main/config/ark/wbui2/cluster.json';

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function safe(value, max = 300) {
  return String(value || '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function patchSection(input, section, updates) {
  const text = String(input || '');
  const newline = text.includes('\r\n') ? '\r\n' : '\n';
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const wanted = `[${section}]`.toLowerCase();
  let start = lines.findIndex((line) => line.trim().toLowerCase() === wanted);
  if (start < 0) {
    if (lines.length && lines.at(-1) !== '') lines.push('');
    start = lines.length;
    lines.push(`[${section}]`);
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*\[.*\]\s*$/.test(lines[i])) { end = i; break; }
  }
  for (const [key, value] of Object.entries(updates)) {
    const re = new RegExp(`^\\s*${key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=`, 'i');
    const matches = [];
    for (let i = start + 1; i < end; i += 1) if (re.test(lines[i])) matches.push(i);
    if (matches.length) {
      lines[matches[0]] = `${key}=${value}`;
      for (let j = matches.length - 1; j >= 1; j -= 1) { lines.splice(matches[j], 1); end -= 1; }
    } else {
      lines.splice(end, 0, `${key}=${value}`);
      end += 1;
    }
  }
  return lines.join(newline);
}

function readWbuiSection(input) {
  const lines = String(input || '').replace(/\r\n/g, '\n').split('\n');
  const out = {};
  let active = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (/^\[.*\]$/.test(line)) { active = line.toLowerCase() === '[wbui2]'; continue; }
    if (!active || !line || line.startsWith(';') || line.startsWith('#')) continue;
    const idx = line.indexOf('=');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim();
    if (!/^(JsonURL|ForceLoadSaveGame|DisableDebugWebhook)$/i.test(key)) continue;
    out[key] = line.slice(idx + 1).trim();
  }
  return out;
}

async function verifyHostedJson() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  timer.unref?.();
  try {
    const response = await fetch(JSON_URL, { cache: 'no-store', signal: controller.signal });
    const body = await response.text();
    let valid = false;
    let version = null;
    try {
      const parsed = JSON.parse(body);
      valid = Boolean(parsed?.WBUI2 && Array.isArray(parsed.WBUI2.tabs));
      version = parsed?.WBUI2?.version ?? null;
    } catch {}
    console.log(`[Nexus Sentinal] WBUI2 hosted JSON: status=${response.status} bytes=${Buffer.byteLength(body)} valid=${valid} version=${version ?? 'unknown'} url=${JSON_URL}`);
    if (!response.ok || !valid) throw new Error(`Hosted WBUI2 JSON invalid/unreachable (${response.status}).`);
  } finally {
    clearTimeout(timer);
  }
}

async function repairIniAndInspectSaveState() {
  const settings = sftpSettingsFromEnv(PREFIX);
  const gus = String(process.env.ARK_GEN1_GUS_PATH || '').trim();
  if (!gus) throw new Error('ARK_GEN1_GUS_PATH is missing.');
  const client = new SftpClient('nexus-wbui2-repair');
  await client.connect({ host: settings.host, port: settings.port, username: settings.username, password: settings.password, readyTimeout: settings.readyTimeout || 12000 });
  try {
    const currentBuf = await client.get(gus);
    const current = Buffer.isBuffer(currentBuf) ? currentBuf.toString('utf8') : String(currentBuf || '');
    const before = readWbuiSection(current);
    console.log(`[Nexus Sentinal] WBUI2 live INI before: JsonURL=${safe(before.JsonURL || before.JsonUrl || '(missing)')} ForceLoadSaveGame=${safe(before.ForceLoadSaveGame || '(missing)')}`);

    const next = patchSection(current, 'WBUI2', {
      JsonURL: `\"${JSON_URL}\"`,
      ForceLoadSaveGame: 'False',
      DisableDebugWebhook: 'True'
    });

    if (next !== current) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const parent = path.posix.dirname(gus);
      const backupDir = path.posix.join(parent, 'NexusBackups', `WBUI2-${stamp}`);
      await client.mkdir(backupDir, true);
      const backup = path.posix.join(backupDir, path.posix.basename(gus));
      await client.put(Buffer.from(current, 'utf8'), backup);
      await client.put(Buffer.from(next, 'utf8'), gus);
      const verifyBuf = await client.get(gus);
      const verify = Buffer.isBuffer(verifyBuf) ? verifyBuf.toString('utf8') : String(verifyBuf || '');
      if (verify !== next) throw new Error('WBUI2 INI write verification failed.');
      console.log(`[Nexus Sentinal] WBUI2 live INI repaired: changed=true backup=${backup}`);
    } else {
      console.log('[Nexus Sentinal] WBUI2 live INI repaired: changed=false');
    }

    const afterBuf = await client.get(gus);
    const after = readWbuiSection(Buffer.isBuffer(afterBuf) ? afterBuf.toString('utf8') : String(afterBuf || ''));
    console.log(`[Nexus Sentinal] WBUI2 live INI after: JsonURL=${safe(after.JsonURL || after.JsonUrl || '(missing)')} ForceLoadSaveGame=${safe(after.ForceLoadSaveGame || '(missing)')}`);

    const rootMatch = gus.match(/^(.*\/ShooterGame)\/Saved\/Config\/WindowsServer\/GameUserSettings\.ini$/i);
    if (rootMatch) {
      const wbuiSaveDir = `${rootMatch[1]}/Saved/SaveGames/WBUI2`;
      let entries = [];
      try { entries = (await client.list(wbuiSaveDir)).map((x) => x.name).slice(0, 20); } catch {}
      console.log(`[Nexus Sentinal] WBUI2 saved override state: dir=${entries.length ? 'present' : 'missing-or-empty'} entries=${entries.join(',') || '(none)'}`);
    }
  } finally {
    await client.end().catch(() => {});
  }
}

async function refreshViaRcon() {
  const server = arkServerFromEnv(PREFIX);
  const client = new ArkRconClient({ host: server.host, port: server.port, password: server.password, timeoutMs: 10000 });
  const response = await client.execute('scriptcommand WBUI2 update');
  console.log(`[Nexus Sentinal] WBUI2 RCON refresh sent: responseBytes=${Buffer.byteLength(String(response || ''))}`);
}

async function inspectLatestWbuiLog() {
  const settings = sftpSettingsFromEnv(PREFIX);
  const gus = String(process.env.ARK_GEN1_GUS_PATH || '').trim();
  const rootMatch = gus.match(/^(.*\/ShooterGame)\/Saved\/Config\/WindowsServer\/GameUserSettings\.ini$/i);
  if (!rootMatch) return;
  const logsDir = `${rootMatch[1]}/Saved/Logs`;
  const client = new SftpClient('nexus-wbui2-log-check');
  await client.connect({ host: settings.host, port: settings.port, username: settings.username, password: settings.password, readyTimeout: settings.readyTimeout || 12000 });
  try {
    const files = await client.list(logsDir);
    const logs = files.filter((f) => /ShooterGame.*\.log$/i.test(f.name)).sort((a, b) => Number(b.modifyTime || 0) - Number(a.modifyTime || 0));
    if (!logs.length) return;
    const remote = `${logsDir}/${logs[0].name}`;
    const stat = await client.stat(remote);
    const max = 512 * 1024;
    const start = Math.max(0, Number(stat.size || 0) - max);
    let data;
    try { data = await client.get(remote, undefined, { readStreamOptions: { start } }); } catch { data = await client.get(remote); }
    const text = Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
    const lines = text.replace(/\r\n/g, '\n').split('\n').filter((line) => /\[WBUI\]/i.test(line) && /(JsonURL|Request|Json\]|INI-Setting|Updated Settings)/i.test(line)).slice(-20);
    console.log(`[Nexus Sentinal] WBUI2 post-refresh log lines=${lines.length} file=${logs[0].name}`);
    for (const line of lines) console.log(`[Nexus Sentinal] WBUI2 post-refresh: ${safe(line, 500)}`);
  } finally {
    await client.end().catch(() => {});
  }
}

async function run() {
  try {
    await verifyHostedJson();
    await repairIniAndInspectSaveState();
    await refreshViaRcon();
    await sleep(8000);
    await inspectLatestWbuiLog();
    console.log('[Nexus Sentinal] WBUI2 repair pass complete.');
  } catch (error) {
    console.error(`[Nexus Sentinal] WBUI2 repair FAILED: ${safe(error?.message || error, 600)}`);
  }
}

setTimeout(() => void run(), 7000).unref?.();

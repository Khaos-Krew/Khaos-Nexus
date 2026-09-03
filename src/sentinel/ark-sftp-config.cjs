'use strict';

const fs = require('node:fs');
const path = require('node:path');
const SftpClient = require('ssh2-sftp-client');

const GAME_USER_SETTINGS_PATH = 'ShooterGame/Saved/Config/WindowsServer/GameUserSettings.ini';
const GAME_INI_PATH = 'ShooterGame/Saved/Config/WindowsServer/Game.ini';
const SOURCE_OF_TRUTH_ROOT = path.resolve(__dirname, '../../config/ark/source-of-truth');

function parseIniSection(input, sectionName) {
  const lines = String(input ?? '').replace(/\r\n/g, '\n').split('\n');
  const wanted = `[${sectionName}]`.toLowerCase();
  const start = lines.findIndex((line) => line.trim().toLowerCase() === wanted);
  if (start < 0) throw new Error(`Canonical ARK INI is missing required section [${sectionName}].`);
  const values = {};
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (/^\[.*\]$/.test(line)) break;
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    const value = line.slice(equals + 1).trim();
    if (Object.prototype.hasOwnProperty.call(values, key) && values[key] !== value) throw new Error(`Canonical ARK INI has conflicting duplicate key ${key} in [${sectionName}].`);
    values[key] = value;
  }
  return Object.freeze(values);
}

function comparableValue(value) {
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return String(value ?? '').trim().toLowerCase();
}

function assertRegistryParity(gus, game, registry) {
  const values = registry?.values;
  if (!values || typeof values !== 'object') throw new Error('Canonical ARK rates.json is missing values.');
  const mismatches = [];
  const compare = (ini, key, expected, group) => {
    if (!Object.prototype.hasOwnProperty.call(ini, key)) return mismatches.push(`${group}.${key}=missing`);
    if (comparableValue(ini[key]) !== comparableValue(expected)) mismatches.push(`${group}.${key}:ini=${ini[key]} registry=${expected}`);
  };
  for (const [key, value] of Object.entries(values.server_settings || {})) compare(gus, key, value, 'server_settings');
  for (const [key, value] of Object.entries(values.game_mode || {})) compare(game, key, value, 'game_mode');
  for (const [index, value] of Object.entries(values.player_stats || {})) compare(game, `PerLevelStatsMultiplier_Player[${index}]`, value, 'player_stats');
  for (const [index, value] of Object.entries(values.tamed_dino_stats || {})) compare(game, `PerLevelStatsMultiplier_DinoTamed[${index}]`, value, 'tamed_dino_stats');
  if (mismatches.length) throw new Error(`Canonical ARK rates registry does not match INIs: ${mismatches.slice(0, 12).join('; ')}${mismatches.length > 12 ? `; +${mismatches.length - 12} more` : ''}`);
  return true;
}

function loadCanonicalBaseline(root = SOURCE_OF_TRUTH_ROOT) {
  const gusFile = path.join(root, 'cluster', 'GameUserSettings.ini');
  const gameFile = path.join(root, 'cluster', 'Game.ini');
  const ratesFile = path.join(root, 'cluster', 'rates.json');
  if (!fs.existsSync(gusFile) || !fs.existsSync(gameFile) || !fs.existsSync(ratesFile)) throw new Error(`Canonical ARK source-of-truth is incomplete at ${root}.`);
  const gus = parseIniSection(fs.readFileSync(gusFile, 'utf8'), 'ServerSettings');
  const game = parseIniSection(fs.readFileSync(gameFile, 'utf8'), '/Script/ShooterGame.ShooterGameMode');
  let rates;
  try { rates = JSON.parse(fs.readFileSync(ratesFile, 'utf8')); } catch (error) { throw new Error(`Canonical ARK rates.json is invalid JSON: ${error.message}`); }
  assertRegistryParity(gus, game, rates);
  return Object.freeze({ gus, game, rates: Object.freeze(rates), gusFile, gameFile, ratesFile });
}

const CANONICAL_BASELINE = loadCanonicalBaseline();
const BASELINE_GUS = CANONICAL_BASELINE.gus;
const BASELINE_GAME = CANONICAL_BASELINE.game;

function escapeRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
function patchIniSection(input, sectionName, updates) {
  const original = String(input ?? ''); const newline = original.includes('\r\n') ? '\r\n' : '\n'; const lines = original.replace(/\r\n/g, '\n').split('\n'); const wanted = `[${sectionName}]`.toLowerCase(); let start = lines.findIndex((line) => line.trim().toLowerCase() === wanted);
  if (start < 0) { if (lines.length && lines.at(-1) !== '') lines.push(''); start = lines.length; lines.push(`[${sectionName}]`); }
  let end = lines.length; for (let index = start + 1; index < lines.length; index += 1) if (/^\s*\[.*\]\s*$/.test(lines[index])) { end = index; break; }
  for (const [key, value] of Object.entries(updates)) { const matcher = new RegExp(`^\\s*${escapeRegex(key)}\\s*=`, 'i'); const matches = []; for (let index = start + 1; index < end; index += 1) if (matcher.test(lines[index])) matches.push(index); if (matches.length) { lines[matches[0]] = `${key}=${value}`; for (let offset = matches.length - 1; offset >= 1; offset -= 1) { lines.splice(matches[offset], 1); end -= 1; } } else { lines.splice(end, 0, `${key}=${value}`); end += 1; } }
  return lines.join(newline);
}
function sftpSettingsFromEnv(prefix = 'ARK_GEN1') { const port = Number(process.env[`${prefix}_SFTP_PORT`] || 22); return { host: String(process.env[`${prefix}_SFTP_HOST`] || '').trim(), port: Number.isInteger(port) && port > 0 ? port : 22, username: String(process.env[`${prefix}_SFTP_USERNAME`] || '').trim(), password: String(process.env[`${prefix}_SFTP_PASSWORD`] || ''), root: String(process.env[`${prefix}_SFTP_ROOT`] || '').trim(), readyTimeout: 12000 }; }
function remotePath(root, relativePath) { const cleanRelative = String(relativePath || '').replace(/^\/+/, ''); if (!root || root === '.') return cleanRelative; return path.posix.join(root.replace(/\\/g, '/'), cleanRelative); }
async function connectSftp(settings) { if (!settings.host || !settings.username || !settings.password) throw new Error('ARK SFTP variables are incomplete. Host, username, and password are required.'); const client = new SftpClient('khaos-nexus-ark'); await client.connect({ host: settings.host, port: settings.port, username: settings.username, password: settings.password, readyTimeout: settings.readyTimeout }); return client; }
async function readRemoteText(client, remoteFile) { const data = await client.get(remoteFile); return Buffer.isBuffer(data) ? data.toString('utf8') : String(data || ''); }
function timestampFolder(now = new Date()) { return now.toISOString().replace(/[:.]/g, '-'); }
async function backupAndWrite(client, remoteFile, nextText, stamp) { const current = await readRemoteText(client, remoteFile); if (current === nextText) return { changed: false, backup: null }; const parent = path.posix.dirname(remoteFile); const backupDir = path.posix.join(parent, 'NexusBackups', stamp); await client.mkdir(backupDir, true); const backup = path.posix.join(backupDir, path.posix.basename(remoteFile)); await client.put(Buffer.from(current, 'utf8'), backup); await client.put(Buffer.from(nextText, 'utf8'), remoteFile); const verify = await readRemoteText(client, remoteFile); if (verify !== nextText) throw new Error(`ARK config verification failed after writing ${remoteFile}.`); return { changed: true, backup }; }
async function applyBaseline(prefix = 'ARK_GEN1') { const settings = sftpSettingsFromEnv(prefix); const gusPath = remotePath(settings.root, process.env[`${prefix}_GUS_PATH`] || GAME_USER_SETTINGS_PATH); const gamePath = remotePath(settings.root, process.env[`${prefix}_GAMEINI_PATH`] || GAME_INI_PATH); const client = await connectSftp(settings); const stamp = timestampFolder(); try { const [currentGus, currentGame] = await Promise.all([readRemoteText(client, gusPath), readRemoteText(client, gamePath)]); const nextGus = patchIniSection(currentGus, 'ServerSettings', BASELINE_GUS); const nextGame = patchIniSection(currentGame, '/Script/ShooterGame.ShooterGameMode', BASELINE_GAME); const gus = await backupAndWrite(client, gusPath, nextGus, stamp); const game = await backupAndWrite(client, gamePath, nextGame, stamp); return { profile: 'git-canonical-gen1-bootstrap-v1', sourceOfTruthRoot: SOURCE_OF_TRUTH_ROOT, gusPath, gamePath, changed: gus.changed || game.changed, gameUserSettingsChanged: gus.changed, gameIniChanged: game.changed, backups: [gus.backup, game.backup].filter(Boolean) }; } finally { await client.end().catch(() => {}); } }
async function applyBaselineIfRequested({ prefix = 'ARK_GEN1', stampDirectory = '/app/data' } = {}) { const request = String(process.env[`${prefix}_CONFIG_APPLY_ONCE`] || '').trim(); if (!request) return { skipped: 'not-requested' }; const safeRequest = request.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80) || 'baseline'; const stampFile = path.join(stampDirectory, `ark-config-${prefix.toLowerCase()}-${safeRequest}.done.json`); if (fs.existsSync(stampFile)) return { skipped: 'already-applied', stampFile }; const result = await applyBaseline(prefix); fs.mkdirSync(stampDirectory, { recursive: true }); fs.writeFileSync(stampFile, JSON.stringify({ request, appliedAt: new Date().toISOString(), result }, null, 2)); return { ...result, stampFile }; }
module.exports = { BASELINE_GUS, BASELINE_GAME, CANONICAL_BASELINE, SOURCE_OF_TRUTH_ROOT, GAME_USER_SETTINGS_PATH, GAME_INI_PATH, parseIniSection, assertRegistryParity, loadCanonicalBaseline, patchIniSection, sftpSettingsFromEnv, remotePath, applyBaseline, applyBaselineIfRequested };

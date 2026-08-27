'use strict';

const fs = require('node:fs');
const path = require('node:path');
const SftpClient = require('ssh2-sftp-client');

const GAME_USER_SETTINGS_PATH = 'ShooterGame/Saved/Config/WindowsServer/GameUserSettings.ini';
const GAME_INI_PATH = 'ShooterGame/Saved/Config/WindowsServer/Game.ini';

const BASELINE_GUS = Object.freeze({
  ServerPVE: 'True',
  DifficultyOffset: '1.0',
  OverrideOfficialDifficulty: '5.0',
  XPMultiplier: '5.0',
  TamingSpeedMultiplier: '10.0',
  HarvestAmountMultiplier: '5.0',
  HarvestHealthMultiplier: '2.0',
  DinoCountMultiplier: '1.0',
  PlayerCharacterFoodDrainMultiplier: '0.75',
  PlayerCharacterWaterDrainMultiplier: '0.75',
  PlayerCharacterStaminaDrainMultiplier: '0.85',
  DinoCharacterStaminaDrainMultiplier: '0.85',
  PlayerCharacterHealthRecoveryMultiplier: '1.5',
  DinoCharacterHealthRecoveryMultiplier: '2.0',
  ResourcesRespawnPeriodMultiplier: '0.5',
  ResourceNoReplenishRadiusPlayers: '0.5',
  ResourceNoReplenishRadiusStructures: '0.5',
  CropGrowthSpeedMultiplier: '8.0',
  SupplyCrateLootQualityMultiplier: '2.5',
  FishingLootQualityMultiplier: '2.0',
  GlobalSpoilingTimeMultiplier: '2.0',
  GlobalItemDecompositionTimeMultiplier: '2.0',
  GlobalCorpseDecompositionTimeMultiplier: '2.0',
  ServerCrosshair: 'True',
  AllowHitMarkers: 'True',
  allowThirdPersonPlayer: 'True',
  ShowMapPlayerLocation: 'True',
  PreventSpawnAnimations: 'True',
  AllowFlyerCarryPvE: 'True',
  bForceCanRideFliers: 'True',
  ForceAllowCaveFlyers: 'True',
  AllowCaveBuildingPvE: 'True',
  RCONEnabled: 'True'
});

const BASELINE_GAME = Object.freeze({
  bUseSingleplayerSettings: 'False',
  bAllowFlyerSpeedLeveling: 'True',
  bAllowSpeedLeveling: 'True',
  MatingIntervalMultiplier: '0.10',
  EggHatchSpeedMultiplier: '20.0',
  BabyMatureSpeedMultiplier: '15.0',
  BabyCuddleIntervalMultiplier: '0.10',
  BabyImprintAmountMultiplier: '2.0',
  BabyImprintingStatScaleMultiplier: '1.0',
  LayEggIntervalMultiplier: '0.5',
  'PerLevelStatsMultiplier_Player[0]': '1.0',
  'PerLevelStatsMultiplier_Player[1]': '1.5',
  'PerLevelStatsMultiplier_Player[7]': '5.0',
  'PerLevelStatsMultiplier_Player[8]': '1.0',
  'PerLevelStatsMultiplier_Player[10]': '2.0',
  'PerLevelStatsMultiplier_DinoTamed[0]': '0.25',
  'PerLevelStatsMultiplier_DinoTamed[1]': '1.5',
  'PerLevelStatsMultiplier_DinoTamed[7]': '3.0',
  'PerLevelStatsMultiplier_DinoTamed[8]': '0.17'
});

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function patchIniSection(input, sectionName, updates) {
  const original = String(input ?? '');
  const newline = original.includes('\r\n') ? '\r\n' : '\n';
  const lines = original.replace(/\r\n/g, '\n').split('\n');
  const wanted = `[${sectionName}]`.toLowerCase();
  let start = lines.findIndex((line) => line.trim().toLowerCase() === wanted);

  if (start < 0) {
    if (lines.length && lines.at(-1) !== '') lines.push('');
    start = lines.length;
    lines.push(`[${sectionName}]`);
  }

  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^\s*\[.*\]\s*$/.test(lines[index])) {
      end = index;
      break;
    }
  }

  for (const [key, value] of Object.entries(updates)) {
    const matcher = new RegExp(`^\\s*${escapeRegex(key)}\\s*=`, 'i');
    const matches = [];
    for (let index = start + 1; index < end; index += 1) {
      if (matcher.test(lines[index])) matches.push(index);
    }
    if (matches.length) {
      lines[matches[0]] = `${key}=${value}`;
      for (let offset = matches.length - 1; offset >= 1; offset -= 1) {
        lines.splice(matches[offset], 1);
        end -= 1;
      }
    } else {
      lines.splice(end, 0, `${key}=${value}`);
      end += 1;
    }
  }

  return lines.join(newline);
}

function sftpSettingsFromEnv(prefix = 'ARK_GEN1') {
  const port = Number(process.env[`${prefix}_SFTP_PORT`] || 22);
  return {
    host: String(process.env[`${prefix}_SFTP_HOST`] || '').trim(),
    port: Number.isInteger(port) && port > 0 ? port : 22,
    username: String(process.env[`${prefix}_SFTP_USERNAME`] || '').trim(),
    password: String(process.env[`${prefix}_SFTP_PASSWORD`] || ''),
    root: String(process.env[`${prefix}_SFTP_ROOT`] || '').trim(),
    readyTimeout: 12000
  };
}

function remotePath(root, relativePath) {
  const cleanRelative = String(relativePath || '').replace(/^\/+/, '');
  if (!root || root === '.') return cleanRelative;
  return path.posix.join(root.replace(/\\/g, '/'), cleanRelative);
}

async function connectSftp(settings) {
  if (!settings.host || !settings.username || !settings.password) {
    throw new Error('ARK SFTP variables are incomplete. Host, username, and password are required.');
  }
  const client = new SftpClient('khaos-nexus-ark');
  await client.connect({
    host: settings.host,
    port: settings.port,
    username: settings.username,
    password: settings.password,
    readyTimeout: settings.readyTimeout
  });
  return client;
}

async function readRemoteText(client, remoteFile) {
  const data = await client.get(remoteFile);
  return Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
}

function timestampFolder(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, '-');
}

async function backupAndWrite(client, remoteFile, nextText, stamp) {
  const current = await readRemoteText(client, remoteFile);
  if (current === nextText) return { changed: false, backup: null };
  const parent = path.posix.dirname(remoteFile);
  const backupDir = path.posix.join(parent, 'NexusBackups', stamp);
  await client.mkdir(backupDir, true);
  const backup = path.posix.join(backupDir, path.posix.basename(remoteFile));
  await client.put(Buffer.from(current, 'utf8'), backup);
  await client.put(Buffer.from(nextText, 'utf8'), remoteFile);
  const verify = await readRemoteText(client, remoteFile);
  if (verify !== nextText) throw new Error(`ARK config verification failed after writing ${remoteFile}.`);
  return { changed: true, backup };
}

async function applyBaseline(prefix = 'ARK_GEN1') {
  const settings = sftpSettingsFromEnv(prefix);
  const gusPath = remotePath(settings.root, process.env[`${prefix}_GUS_PATH`] || GAME_USER_SETTINGS_PATH);
  const gamePath = remotePath(settings.root, process.env[`${prefix}_GAMEINI_PATH`] || GAME_INI_PATH);
  const client = await connectSftp(settings);
  const stamp = timestampFolder();
  try {
    const [currentGus, currentGame] = await Promise.all([
      readRemoteText(client, gusPath),
      readRemoteText(client, gamePath)
    ]);
    const nextGus = patchIniSection(currentGus, 'ServerSettings', BASELINE_GUS);
    const nextGame = patchIniSection(currentGame, '/Script/ShooterGame.ShooterGameMode', BASELINE_GAME);
    const gus = await backupAndWrite(client, gusPath, nextGus, stamp);
    const game = await backupAndWrite(client, gamePath, nextGame, stamp);
    return {
      profile: 'khaos-pve-baseline-v1',
      gusPath,
      gamePath,
      changed: gus.changed || game.changed,
      gameUserSettingsChanged: gus.changed,
      gameIniChanged: game.changed,
      backups: [gus.backup, game.backup].filter(Boolean)
    };
  } finally {
    await client.end().catch(() => {});
  }
}

async function applyBaselineIfRequested({ prefix = 'ARK_GEN1', stampDirectory = '/app/data' } = {}) {
  const request = String(process.env[`${prefix}_CONFIG_APPLY_ONCE`] || '').trim();
  if (!request) return { skipped: 'not-requested' };
  const safeRequest = request.replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 80) || 'baseline';
  const stampFile = path.join(stampDirectory, `ark-config-${prefix.toLowerCase()}-${safeRequest}.done.json`);
  if (fs.existsSync(stampFile)) return { skipped: 'already-applied', stampFile };
  const result = await applyBaseline(prefix);
  fs.mkdirSync(stampDirectory, { recursive: true });
  fs.writeFileSync(stampFile, JSON.stringify({ request, appliedAt: new Date().toISOString(), result }, null, 2));
  return { ...result, stampFile };
}

module.exports = {
  BASELINE_GUS,
  BASELINE_GAME,
  GAME_USER_SETTINGS_PATH,
  GAME_INI_PATH,
  patchIniSection,
  sftpSettingsFromEnv,
  remotePath,
  applyBaseline,
  applyBaselineIfRequested
};

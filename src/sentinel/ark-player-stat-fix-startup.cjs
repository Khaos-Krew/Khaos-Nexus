'use strict';

// One-time Gen 1 survivor stat correction. Safe to rerun; writes are idempotent and backed up.
const path = require('node:path');
const SftpClient = require('ssh2-sftp-client');
const { sftpSettingsFromEnv, patchIniSection } = require('./ark-sftp-config.cjs');

const PREFIX = 'ARK_GEN1';

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

async function getText(client, remote) {
  const data = await client.get(remote);
  return Buffer.isBuffer(data) ? data.toString('utf8') : String(data || '');
}

async function backupAndWrite(client, remote, current, next, label) {
  if (current === next) {
    console.log(`[Nexus Sentinal] ARK player stat fix ${label}: changed=false`);
    return;
  }
  const backupDir = path.posix.join(path.posix.dirname(remote), 'NexusBackups', `PlayerStats-${stamp()}`);
  await client.mkdir(backupDir, true);
  const backup = path.posix.join(backupDir, path.posix.basename(remote));
  await client.put(Buffer.from(current, 'utf8'), backup);
  await client.put(Buffer.from(next, 'utf8'), remote);
  const verify = await getText(client, remote);
  if (verify !== next) {
    await client.put(Buffer.from(current, 'utf8'), remote).catch(() => {});
    throw new Error(`${label} verification failed; previous file restored.`);
  }
  console.log(`[Nexus Sentinal] ARK player stat fix ${label}: changed=true backup=${backup}`);
}

async function run() {
  const settings = sftpSettingsFromEnv(PREFIX);
  const gamePath = String(process.env.ARK_GEN1_GAMEINI_PATH || '').trim();
  const gusPath = String(process.env.ARK_GEN1_GUS_PATH || '').trim();
  if (!gamePath || !gusPath) {
    console.warn('[Nexus Sentinal] ARK player stat fix failed: exact Game.ini/GameUserSettings.ini paths are missing.');
    return;
  }

  const client = new SftpClient('nexus-player-stat-fix');
  try {
    await client.connect({
      host: settings.host,
      port: settings.port,
      username: settings.username,
      password: settings.password,
      readyTimeout: settings.readyTimeout || 12000
    });

    const [currentGame, currentGus] = await Promise.all([
      getText(client, gamePath),
      getText(client, gusPath)
    ]);

    const nextGame = patchIniSection(currentGame, '/Script/ShooterGame.ShooterGameMode', {
      'PerLevelStatsMultiplier_Player[0]': '2.50000',
      'PerLevelStatsMultiplier_Player[1]': '2.00000',
      'PlayerBaseStatMultipliers[0]': '1.50000'
    });

    const nextGus = patchIniSection(currentGus, 'ServerSettings', {
      MaxFallSpeedMultiplier: '3.00000',
      PlayerCharacterHealthRecoveryMultiplier: '2.00000',
      PlayerResistanceMultiplier: '1.00000'
    });

    await backupAndWrite(client, gamePath, currentGame, nextGame, 'Game.ini');
    await backupAndWrite(client, gusPath, currentGus, nextGus, 'GameUserSettings.ini');

    console.log('[Nexus Sentinal] ARK player stat fix staged successfully: healthPerLevel=2.5 staminaPerLevel=2.0 baseHealth=1.5x maxFallSpeed=3.0 healthRecovery=2.0 playerResistance=1.0 restartRequired=true');
  } catch (error) {
    console.warn(`[Nexus Sentinal] ARK player stat fix failed: ${String(error?.message || error).slice(0, 400)}`);
  } finally {
    await client.end().catch(() => {});
  }
}

setTimeout(() => void run(), 6000).unref?.();

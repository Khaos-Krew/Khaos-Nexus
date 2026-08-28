'use strict';

const fs = require('node:fs');
const path = require('node:path');
const SftpClient = require('ssh2-sftp-client');
const sftpConfig = require('./ark-sftp-config.cjs');

const SERVICE_ROOT = '72.46.128.202_8080';
const LOADER_SUFFIX = '/ShooterGame/Binaries/Win64/AsaApiLoader.exe';
const BACKUP_SUFFIX = '/ShooterGame/Binaries/Win64/AsaApiLoader.exe.nexus-original-api-loader.bak';

const originalSettings = sftpConfig.sftpSettingsFromEnv;
const originalRename = SftpClient.prototype.rename;
const originalFastGet = SftpClient.prototype.fastGet;
const originalFastPut = SftpClient.prototype.fastPut;

function isLoader(remote) {
  return String(remote || '').replace(/\\/g, '/').endsWith(LOADER_SUFFIX);
}
function isOriginalBackup(remote) {
  return String(remote || '').replace(/\\/g, '/').endsWith(BACKUP_SUFFIX);
}
function backupPathFor(loaderPath) {
  return String(loaderPath || '').replace(/AsaApiLoader\.exe$/i, 'AsaApiLoader.exe.nexus-original-api-loader.bak');
}
async function copyRemoteViaLocal(client, source, destination) {
  const temp = path.join('/tmp', `nexus-sftp-copy-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}.bin`);
  try {
    const before = await client.stat(source);
    await originalFastGet.call(client, source, temp);
    const local = fs.statSync(temp);
    if (Number(local.size) !== Number(before.size)) throw new Error(`backup download size mismatch ${local.size} != ${before.size}`);
    await originalFastPut.call(client, temp, destination);
    const after = await client.stat(destination);
    if (Number(after.size) !== Number(before.size)) throw new Error(`backup upload size mismatch ${after.size} != ${before.size}`);
    return after;
  } finally {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {}
  }
}
async function restoreLoader(client, loaderPath) {
  const backup = backupPathFor(loaderPath);
  const temp = path.join('/tmp', `nexus-loader-restore-${process.pid}-${Date.now()}.bin`);
  try {
    const backupStat = await client.stat(backup);
    await originalFastGet.call(client, backup, temp);
    const local = fs.statSync(temp);
    if (Number(local.size) !== Number(backupStat.size)) throw new Error(`restore download size mismatch ${local.size} != ${backupStat.size}`);
    await originalFastPut.call(client, temp, loaderPath);
    const restored = await client.stat(loaderPath);
    if (Number(restored.size) !== Number(backupStat.size)) throw new Error(`restore verification mismatch ${restored.size} != ${backupStat.size}`);
    console.warn(`[Nexus Sentinal] Gen 1 recovery shim: original ASA API loader restored after failed overwrite (${restored.size} bytes)`);
  } finally {
    try { if (fs.existsSync(temp)) fs.unlinkSync(temp); } catch {}
  }
}

// Scope Citadel's per-service folder only to the recovery module's captured
// settings function. Other Sentinel SFTP consumers retain their existing paths.
sftpConfig.sftpSettingsFromEnv = function recoverySettings(prefix = 'ARK_GEN1') {
  const settings = originalSettings(prefix);
  return { ...settings, root: settings.root || SERVICE_ROOT };
};

// Citadel's SFTP server rejects rename in Win64. For the one original-loader
// backup operation, emulate rename as a verified copy. The source intentionally
// remains in place until the replacement upload succeeds.
SftpClient.prototype.rename = async function nexusRecoveryRename(source, destination, ...rest) {
  if (isLoader(source) && isOriginalBackup(destination)) {
    const result = await copyRemoteViaLocal(this, source, destination);
    console.log(`[Nexus Sentinal] Gen 1 recovery shim: original ASA API loader copied to verified backup (${result.size} bytes)`);
    return result;
  }
  return originalRename.call(this, source, destination, ...rest);
};

// A direct overwrite is unavoidable on this Citadel SFTP implementation.
// Verify the uploaded size before returning. Any transfer or verification
// failure restores the previously verified original loader before surfacing
// the error to the recovery routine.
SftpClient.prototype.fastPut = async function nexusRecoveryFastPut(localPath, remotePath, options) {
  if (!isLoader(remotePath)) return originalFastPut.call(this, localPath, remotePath, options);
  const expected = fs.statSync(localPath).size;
  try {
    const result = await originalFastPut.call(this, localPath, remotePath, options);
    const remote = await this.stat(remotePath);
    if (Number(remote.size) !== Number(expected)) throw new Error(`loader overwrite verification mismatch ${remote.size} != ${expected}`);
    return result;
  } catch (error) {
    try {
      await restoreLoader(this, remotePath);
    } catch (restoreError) {
      console.error(`[Nexus Sentinal] Gen 1 recovery shim CRITICAL: loader restore failed: ${String(restoreError?.message || restoreError).slice(0, 360)}`);
    }
    throw error;
  }
};

require('./citadel-gen1-api-bypass-recovery-startup.cjs');

// The recovery module captured the scoped settings function during require.
// Restore the shared export so normal Sentinel config operations do not get a
// second service-root prefix.
sftpConfig.sftpSettingsFromEnv = originalSettings;

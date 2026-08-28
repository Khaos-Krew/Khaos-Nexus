'use strict';

const SftpClient = require('ssh2-sftp-client');
const { sftpSettingsFromEnv } = require('./ark-sftp-config.cjs');

const PREFIX = 'ARK_GEN1';
const SAVED = '72.46.128.202_8080/ShooterGame/Saved';
const TARGET = `${SAVED}/AllowedCheaterAccountIDs.txt`;

async function ensureDir(client, dir) {
  const parts = dir.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const exists = await client.exists(current);
    if (!exists) await client.mkdir(current);
  }
}

async function run() {
  const eosId = String(process.env.ARK_GEN1_OWNER_EOS_ID || '').trim();
  if (!/^[0-9a-f]{32}$/i.test(eosId)) {
    console.warn('[Nexus Sentinal] ARK admin whitelist fix skipped: ARK_GEN1_OWNER_EOS_ID missing or invalid');
    return;
  }

  const settings = sftpSettingsFromEnv(PREFIX);
  const client = new SftpClient('nexus-gen1-admin-whitelist-fix');
  try {
    await client.connect({
      host: settings.host,
      port: settings.port,
      username: settings.username,
      password: settings.password,
      readyTimeout: settings.readyTimeout || 12000
    });

    const existing = await client.exists(TARGET);
    let before = '';
    if (existing) {
      const raw = await client.get(TARGET);
      before = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
    }

    const beforeLines = before.split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
    const eosLines = beforeLines.filter((v) => /^[0-9a-f]{32}$/i.test(v));
    const steamLikeLines = beforeLines.filter((v) => /^\d{17}$/.test(v));
    const otherLines = beforeLines.filter((v) => !/^[0-9a-f]{32}$/i.test(v) && !/^\d{17}$/.test(v));
    console.log(`[Nexus Sentinal] ARK admin whitelist before: exists=${Boolean(existing)} entries=${beforeLines.length} eos=${eosLines.length} steamLike=${steamLikeLines.length} other=${otherLines.length}`);

    if (existing) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = `${SAVED}/NexusBackups/AdminWhitelist-${stamp}`;
      await ensureDir(client, backupDir);
      await client.put(Buffer.from(before, 'utf8'), `${backupDir}/AllowedCheaterAccountIDs.txt`);
      console.log(`[Nexus Sentinal] ARK admin whitelist backup created: ${backupDir}/AllowedCheaterAccountIDs.txt`);
    }

    const desired = `${eosId}\n`;
    await client.put(Buffer.from(desired, 'utf8'), TARGET);
    const verifyRaw = await client.get(TARGET);
    const verify = Buffer.isBuffer(verifyRaw) ? verifyRaw.toString('utf8') : String(verifyRaw || '');
    if (verify !== desired) throw new Error('verification mismatch after whitelist write');

    console.log('[Nexus Sentinal] ARK admin whitelist fixed: entries=1 eos=1 verified=true restartRequired=likely');
  } catch (error) {
    console.warn(`[Nexus Sentinal] ARK admin whitelist fix failed: ${String(error?.message || error).slice(0, 300)}`);
  } finally {
    await client.end().catch(() => {});
  }
}

setTimeout(() => void run(), 5000).unref?.();

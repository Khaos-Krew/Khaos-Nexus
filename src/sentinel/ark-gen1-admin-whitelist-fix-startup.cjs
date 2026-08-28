'use strict';

const SftpClient = require('ssh2-sftp-client');
const { sftpSettingsFromEnv } = require('./ark-sftp-config.cjs');

const PREFIX = 'ARK_GEN1';
const SAVED = '72.46.128.202_8080/ShooterGame/Saved';
const TARGET_NAME = 'AllowedCheaterAccountIDs.txt';

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    Promise.resolve(promise),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    })
  ]).finally(() => clearTimeout(timer));
}

async function ensureDir(client, dir) {
  const parts = dir.split('/').filter(Boolean);
  let current = '';
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    const exists = await withTimeout(client.exists(current), 8000, `exists ${current}`);
    if (!exists) await withTimeout(client.mkdir(current), 8000, `mkdir ${current}`);
  }
}

async function run() {
  console.log('[Nexus Sentinal] ARK admin whitelist repair starting');
  const eosId = String(process.env.ARK_GEN1_OWNER_EOS_ID || '').trim();
  if (!/^[0-9a-f]{32}$/i.test(eosId)) {
    console.warn('[Nexus Sentinal] ARK admin whitelist fix skipped: ARK_GEN1_OWNER_EOS_ID missing or invalid');
    return;
  }

  const settings = sftpSettingsFromEnv(PREFIX);
  const client = new SftpClient('nexus-gen1-admin-whitelist-fix');
  try {
    await withTimeout(client.connect({
      host: settings.host,
      port: settings.port,
      username: settings.username,
      password: settings.password,
      readyTimeout: settings.readyTimeout || 12000
    }), 15000, 'SFTP connect');
    console.log('[Nexus Sentinal] ARK admin whitelist SFTP connected');

    const listing = await withTimeout(client.list(SAVED), 10000, 'Saved directory listing');
    const found = listing.find((entry) => String(entry.name || '').toLowerCase() === TARGET_NAME.toLowerCase());
    const target = `${SAVED}/${found?.name || TARGET_NAME}`;
    const existing = Boolean(found);
    let before = '';
    if (existing) {
      const raw = await withTimeout(client.get(target), 10000, 'whitelist read');
      before = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
    }

    const beforeLines = before.split(/\r?\n/).map((v) => v.trim()).filter(Boolean);
    const eosLines = beforeLines.filter((v) => /^[0-9a-f]{32}$/i.test(v));
    const steamLikeLines = beforeLines.filter((v) => /^\d{17}$/.test(v));
    const otherLines = beforeLines.filter((v) => !/^[0-9a-f]{32}$/i.test(v) && !/^\d{17}$/.test(v));
    console.log(`[Nexus Sentinal] ARK admin whitelist before: exists=${existing} entries=${beforeLines.length} eos=${eosLines.length} steamLike=${steamLikeLines.length} other=${otherLines.length}`);

    if (existing) {
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const backupDir = `${SAVED}/NexusBackups/AdminWhitelist-${stamp}`;
      await ensureDir(client, backupDir);
      await withTimeout(client.put(Buffer.from(before, 'utf8'), `${backupDir}/${TARGET_NAME}`), 10000, 'whitelist backup');
      console.log(`[Nexus Sentinal] ARK admin whitelist backup created: ${backupDir}/${TARGET_NAME}`);
    }

    const desired = `${eosId}\n`;
    await withTimeout(client.put(Buffer.from(desired, 'utf8'), target), 10000, 'whitelist write');
    const verifyRaw = await withTimeout(client.get(target), 10000, 'whitelist verification read');
    const verify = Buffer.isBuffer(verifyRaw) ? verifyRaw.toString('utf8') : String(verifyRaw || '');
    if (verify !== desired) throw new Error('verification mismatch after whitelist write');

    console.log('[Nexus Sentinal] ARK admin whitelist fixed: entries=1 eos=1 verified=true restartRequired=likely');
  } catch (error) {
    console.warn(`[Nexus Sentinal] ARK admin whitelist fix failed: ${String(error?.message || error).slice(0, 300)}`);
  } finally {
    await Promise.race([client.end().catch(() => {}), new Promise((resolve) => setTimeout(resolve, 3000))]);
  }
}

setTimeout(() => void run(), 5000).unref?.();

'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const path = require('node:path');
const SftpClient = require('ssh2-sftp-client');
const { sftpSettingsFromEnv } = require('./ark-sftp-config.cjs');

const PREFIX = 'ARK_GEN1';
const ROOT = '72.46.128.202_8080/ShooterGame/Binaries/Win64';
const EXE = `${ROOT}/ArkAscendedServer.exe`;
const CACHE_KEY = `${ROOT}/ArkApi/Cache/cached_key.cache`;

async function run() {
  const settings = sftpSettingsFromEnv(PREFIX);
  const client = new SftpClient('nexus-asa-cache-hash-check');
  const tmp = '/tmp/nexus-ArkAscendedServer.exe';
  try {
    await client.connect({ host: settings.host, port: settings.port, username: settings.username, password: settings.password, readyTimeout: settings.readyTimeout || 12000 });
    const keyRaw = await client.get(CACHE_KEY);
    const keyText = Buffer.isBuffer(keyRaw) ? keyRaw.toString('utf8') : String(keyRaw || '');
    const keyMatch = keyText.match(/[a-f0-9]{64}/i);
    const cacheHash = keyMatch ? keyMatch[0].toLowerCase() : 'unknown';
    const stat = await client.stat(EXE);
    console.log(`[Nexus Sentinal] ASA cache local hash check: downloading serverExeBytes=${Number(stat.size || 0)} cacheHash=${cacheHash}`);
    await client.fastGet(EXE, tmp);
    const hash = crypto.createHash('sha256');
    await new Promise((resolve, reject) => {
      const stream = fs.createReadStream(tmp);
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', reject);
      stream.on('end', resolve);
    });
    const exeHash = hash.digest('hex');
    console.log(`[Nexus Sentinal] ASA cache local hash check: exeHash=${exeHash} cacheHash=${cacheHash} matches=${exeHash === cacheHash}`);
  } catch (error) {
    console.warn(`[Nexus Sentinal] ASA cache local hash check failed: ${String(error?.message || error).slice(0, 300)}`);
  } finally {
    try { fs.unlinkSync(tmp); } catch {}
    await client.end().catch(() => {});
  }
}

setTimeout(() => void run(), 5000).unref?.();

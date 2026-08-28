'use strict';

const path = require('node:path');
const SftpClient = require('ssh2-sftp-client');
const { sftpSettingsFromEnv } = require('./ark-sftp-config.cjs');

const PREFIX = 'ARK_GEN1';
const PLUGINS = '72.46.128.202_8080/ShooterGame/Binaries/Win64/ArkApi/Plugins';

function safeJsonSummary(text) {
  try {
    const obj = JSON.parse(text);
    const keys = ['Name','Version','PluginVersion','FriendlyName','Description','Author','MinApiVersion','ApiVersion'];
    return keys.filter((k) => obj[k] !== undefined).map((k) => `${k}=${String(obj[k]).slice(0,120)}`).join(' ');
  } catch { return 'invalid-json'; }
}

async function run() {
  const settings = sftpSettingsFromEnv(PREFIX);
  const client = new SftpClient('nexus-api-plugin-metadata');
  try {
    await client.connect({ host: settings.host, port: settings.port, username: settings.username, password: settings.password, readyTimeout: settings.readyTimeout || 12000 });
    const dirs = await client.list(PLUGINS);
    for (const dir of dirs.filter((x) => x.type === 'd' || x.type === '-')) {
      const base = path.posix.join(PLUGINS, dir.name);
      let entries = [];
      try { entries = await client.list(base); } catch { continue; }
      const dlls = entries.filter((x) => /\.dll$/i.test(x.name)).map((x) => `${x.name}:${Number(x.size||0)}`).join(',') || '(none)';
      let info = '(none)';
      for (const name of ['PluginInfo.json','plugininfo.json']) {
        try {
          const raw = await client.get(path.posix.join(base, name));
          const text = Buffer.isBuffer(raw) ? raw.toString('utf8') : String(raw || '');
          info = safeJsonSummary(text) || '(no-version-fields)';
          break;
        } catch {}
      }
      console.log(`[Nexus Sentinal] ASA plugin metadata: folder=${dir.name} dlls=${dlls} info=${info}`);
    }
  } catch (error) {
    console.warn(`[Nexus Sentinal] ASA plugin metadata probe failed: ${String(error?.message || error).slice(0,300)}`);
  } finally {
    await client.end().catch(() => {});
  }
}

setTimeout(() => void run(), 5000).unref?.();

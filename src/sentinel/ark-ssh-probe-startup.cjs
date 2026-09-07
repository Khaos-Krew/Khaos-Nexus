'use strict';

const SftpClient = require('ssh2-sftp-client');
const { probeSshExecHash, checkCacheMirrors } = require('./ark-sftp-diagnostic.cjs');
const { sftpSettingsFromEnv } = require('./ark-sftp-config.cjs');

function safe(value) {
  return String(value || '')
    .replace(/password\s*[=:]\s*[^\s,;]+/ig, 'password=[redacted]')
    .replace(/pwd\s*[=:]\s*[^\s,;]+/ig, 'pwd=[redacted]')
    .replace(/(mysql(?:s)?:\/\/[^:\s]+:)[^@\s]+@/ig, '$1[redacted]@')
    .replace(/[\r\n|]/g, ' ')
    .slice(0, 700);
}

function shooterGameRoot(root) {
  const value = String(root || '').trim().replace(/\\/g, '/').replace(/\/+$/g, '');
  if (!value) return '';
  return value.toLowerCase().endsWith('/shootergame') ? value : `${value}/ShooterGame`;
}

async function readBounded(client, path, maxBytes = 4 * 1024 * 1024) {
  try {
    const stat = await client.stat(path);
    if (!stat || Number(stat.size || 0) > maxBytes) return { text: '', size: Number(stat?.size || 0), skipped: true };
    const data = await client.get(path);
    return { text: Buffer.isBuffer(data) ? data.toString('utf8') : String(data || ''), size: Number(stat.size || 0), skipped: false };
  } catch (error) {
    return { text: '', size: 0, skipped: false, error: safe(error?.message || error) };
  }
}

function pluginVersion(text) {
  try {
    const parsed = JSON.parse(String(text || ''));
    return safe(parsed.Version ?? parsed.version ?? parsed.PluginVersion ?? parsed.pluginVersion ?? parsed.Name ?? parsed.name ?? 'unknown');
  } catch {
    return 'unreadable';
  }
}

function interestingLines(text) {
  const pattern = /(arkshop|permissions|asashopui|arkshopui|fatal|crash|exception|offset|singleton|missing|failed|error|api)/i;
  return String(text || '').split(/\r?\n/).filter((line) => pattern.test(line)).slice(-40);
}

async function probeMap2PluginRuntime() {
  const prefix = 'ARK_MAP2';
  if (String(process.env.ARK_MAP2_ENABLED || 'false').toLowerCase() !== 'true') return;
  const settings = sftpSettingsFromEnv(prefix);
  if (!settings.host || !settings.username || !settings.password) {
    console.warn('[Nexus Sentinal] ARK_MAP2 plugin crash probe skipped: SFTP credentials incomplete.');
    return;
  }

  const root = shooterGameRoot(settings.root);
  if (!root) {
    console.warn('[Nexus Sentinal] ARK_MAP2 plugin crash probe skipped: SFTP root missing.');
    return;
  }

  const client = new SftpClient('khaos-nexus-map2-plugin-crash-probe');
  try {
    await client.connect({
      host: settings.host,
      port: settings.port,
      username: settings.username,
      password: settings.password,
      readyTimeout: settings.readyTimeout
    });

    const win64 = `${root}/Binaries/Win64`;
    const plugins = `${win64}/ArkApi/Plugins`;
    const checks = [
      ['ArkShop', `${plugins}/ArkShop`],
      ['Permissions', `${plugins}/Permissions`],
      ['ArkShopUI', `${plugins}/ArkShopUI`],
      ['ASAShopUI', `${plugins}/ASAShopUI`]
    ];

    for (const [name, path] of checks) {
      const info = await readBounded(client, `${path}/PluginInfo.json`, 256 * 1024);
      let dll = null;
      try { dll = await client.stat(`${path}/${name}.dll`); } catch {}
      console.log(`[Nexus Sentinal] ARK_MAP2 plugin probe: plugin=${name} info=${info.text ? 'yes' : 'no'} version=${pluginVersion(info.text)} dll=${dll ? 'yes' : 'no'} dllBytes=${Number(dll?.size || 0)} dllMtime=${Number(dll?.modifyTime || 0)}`);
    }

    let apiLogPath = `${win64}/logs/ArkApi.log`;
    let apiLog = await readBounded(client, apiLogPath);
    if (!apiLog.text) {
      try {
        const entries = await client.list(`${win64}/logs`);
        const names = entries.map((entry) => String(entry.name || '')).filter(Boolean);
        console.log(`[Nexus Sentinal] ARK_MAP2 API log directory: entries=${safe(names.join(',')) || '(none)'}`);
        const candidate = names.find((name) => /arkapi.*\.log$/i.test(name));
        if (candidate) {
          apiLogPath = `${win64}/logs/${candidate}`;
          apiLog = await readBounded(client, apiLogPath);
        }
      } catch (error) {
        console.warn(`[Nexus Sentinal] ARK_MAP2 API log directory read failed: ${safe(error?.message || error)}`);
      }
    }

    console.log(`[Nexus Sentinal] ARK_MAP2 ArkApi log probe: path=${safe(apiLogPath)} bytes=${apiLog.size || 0} skipped=${Boolean(apiLog.skipped)} error=${apiLog.error || 'none'}`);
    for (const line of interestingLines(apiLog.text)) {
      console.log(`[Nexus Sentinal] ARK_MAP2 ArkApi log: ${safe(line)}`);
    }

    const shooterLogPath = `${root}/Saved/Logs/ShooterGame.log`;
    const shooterLog = await readBounded(client, shooterLogPath);
    console.log(`[Nexus Sentinal] ARK_MAP2 ShooterGame crash probe: bytes=${shooterLog.size || 0} skipped=${Boolean(shooterLog.skipped)} error=${shooterLog.error || 'none'}`);
    for (const line of interestingLines(shooterLog.text)) {
      console.log(`[Nexus Sentinal] ARK_MAP2 ShooterGame crash line: ${safe(line)}`);
    }
  } catch (error) {
    console.warn(`[Nexus Sentinal] ARK_MAP2 plugin crash probe failed: ${safe(error?.message || error)}`);
  } finally {
    await client.end().catch(() => {});
  }
}

if (String(process.env.ARK_GEN1_ENABLED || 'false').toLowerCase() === 'true') {
  const timer = setTimeout(() => {
    void probeSshExecHash('ARK_GEN1')
      .then(async (result) => {
        console.log(`[Nexus Sentinal] ARK SSH checksum probe: available=${result.available} sha256=${result.hash || 'unavailable'} error=${result.error || 'none'}`);
        if (!result.hash) return;
        const mirrors = await checkCacheMirrors(result.hash);
        console.log(`[Nexus Sentinal] ASA API SSH-hash mirrors: ${mirrors.map((item) => `${new URL(item.base).host}=${item.available ? 'available' : `http-${item.status || 'error'}`}${item.length ? `:${item.length}` : ''}`).join(' ') || '(none)'}`);
      })
      .catch((error) => console.warn(`[Nexus Sentinal] ARK SSH checksum probe failed: ${String(error?.message || error).slice(0, 200)}`));
  }, 5_000);
  timer.unref?.();
}

if (String(process.env.ARK_MAP2_ENABLED || 'false').toLowerCase() === 'true') {
  const timer = setTimeout(() => {
    void probeMap2PluginRuntime();
  }, 8_000);
  timer.unref?.();
}

'use strict';

const { probeSshExecHash, checkCacheMirrors } = require('./ark-sftp-diagnostic.cjs');

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

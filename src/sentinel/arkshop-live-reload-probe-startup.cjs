'use strict';

const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

async function probe() {
  const server = arkServerFromEnv('ARK_GEN1');
  let lastError = '';
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const client = new ArkRconClient({ host: server.host, port: server.port, password: server.password, timeoutMs: 10000 });
      const before = await client.execute('ListPlayers');
      const reload = await client.execute('ArkShop.Reload');
      const after = await client.execute('ListPlayers');
      console.log(`[Nexus Sentinal] ArkShop live reload probe: ok=true attempt=${attempt} beforeBytes=${Buffer.byteLength(String(before || ''))} reloadResponse=${JSON.stringify(String(reload || '').slice(0,180))} afterBytes=${Buffer.byteLength(String(after || ''))} serverRestarted=false`);
      return;
    } catch (error) {
      lastError = String(error?.message || error).replace(/[\r\n]+/g, ' ').slice(0, 240);
      console.warn(`[Nexus Sentinal] ArkShop live reload probe retry: attempt=${attempt} error=${lastError}`);
      await sleep(12000);
    }
  }
  console.error(`[Nexus Sentinal] ArkShop live reload probe: ok=false error=${lastError}`);
}

const timer = setTimeout(() => void probe(), 7000);
timer.unref?.();

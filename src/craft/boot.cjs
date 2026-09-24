'use strict';

const http = require('node:http');

function healthPayload(state = {}) {
  const discord = state.discord === 'ready' || state.discord === 'starting' || state.discord === 'idle'
    ? state.discord
    : 'idle';
  return {
    ok: true,
    service: 'nexus-craft',
    bot: 'Nexus Craft',
    discord
  };
}

function createHealthServer(port, getState) {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (req.method !== 'GET' || url.pathname !== '/health') {
      const missing = Buffer.from(JSON.stringify({ ok: false }));
      res.writeHead(404, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': missing.length,
        'cache-control': 'no-store'
      });
      res.end(missing);
      return;
    }
    const body = Buffer.from(JSON.stringify(healthPayload(typeof getState === 'function' ? getState() : {})));
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': body.length,
      'cache-control': 'no-store'
    });
    res.end(body);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

function writeLog(log, line) {
  if (typeof log === 'function') log(line);
  else console.log(line);
}

async function startNexusCraft(options = {}) {
  const env = options.env || process.env;
  const port = Number.isInteger(options.port) ? options.port : Number(env.PORT || 8080);
  const state = { discord: 'idle' };
  const server = await createHealthServer(port, () => state);
  const token = String(env.NEXUS_CRAFT_TOKEN || '').trim();
  if (!token) {
    writeLog(options.log, '[Nexus Craft] token missing, Discord idle');
    return { server, idle: true, state };
  }
  state.discord = 'starting';
  const { startCraftDiscord } = require('./bot.cjs');
  await startCraftDiscord({ env, state, token, client: options.client });
  return { server, idle: false, state };
}

module.exports = { createHealthServer, healthPayload, startNexusCraft };

'use strict';

const { Client, Events } = require('discord.js');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.rcon.diagnostic.extension');
const BOUND = Symbol.for('khaos.nexus.ark.rcon.diagnostic.bound');
const PREFIXES = Object.freeze(['ARK_GEN1', 'ARK_MAP2']);
const INITIAL_DELAY_MS = 12_000;
const INTERVAL_MS = 5 * 60_000;

function configured(prefix, env = process.env) {
  return Boolean(String(env[`${prefix}_HOST`] || '').trim() && String(env[`${prefix}_RCON_PORT`] || '').trim());
}

function classifyRconError(error) {
  const message = String(error?.message || error || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 300);
  const lower = message.toLowerCase();
  if (/econnrefused|connection refused/.test(lower)) return { code: 'connection-refused', message };
  if (/etimedout|tcp connection timed out/.test(lower)) return { code: 'tcp-timeout', message };
  if (/authentication failed/.test(lower)) return { code: 'auth-failed', message };
  if (/authentication response timed out/.test(lower)) return { code: 'auth-timeout', message };
  if (/closed before authentication/.test(lower)) return { code: 'closed-before-auth', message };
  if (/command response timed out/.test(lower)) return { code: 'command-timeout', message };
  if (/password is missing/.test(lower)) return { code: 'password-missing', message };
  if (/port is invalid/.test(lower)) return { code: 'port-invalid', message };
  if (/host is missing/.test(lower)) return { code: 'host-missing', message };
  return { code: 'other', message };
}

async function probePrefix(prefix, env = process.env) {
  if (!configured(prefix, env)) return { prefix, skipped: 'not-configured' };
  const server = arkServerFromEnv(prefix);
  try {
    const client = new ArkRconClient({ host: server.host, port: server.port, password: server.password, timeoutMs: 8_000 });
    const response = await client.execute('ListPlayers');
    return {
      prefix,
      serverName: server.name,
      host: server.host,
      port: server.port,
      ok: true,
      responseBytes: Buffer.byteLength(String(response || ''))
    };
  } catch (error) {
    const classified = classifyRconError(error);
    return {
      prefix,
      serverName: server.name,
      host: server.host,
      port: server.port,
      ok: false,
      errorCode: classified.code,
      error: classified.message
    };
  }
}

function signature(result = {}) {
  return [result.prefix, result.ok === true ? 'ok' : 'fail', result.errorCode || '', result.error || ''].join('|');
}

function logResult(result, reason = 'periodic') {
  if (result?.skipped) return;
  if (result.ok) {
    console.log(`[Nexus Sentinal] ARK RCON diagnostic (${reason}): prefix=${result.prefix} server=${result.serverName || result.prefix} endpoint=${result.host}:${result.port} ok=true responseBytes=${result.responseBytes || 0}`);
    return;
  }
  console.warn(`[Nexus Sentinal] ARK RCON diagnostic (${reason}): prefix=${result.prefix} server=${result.serverName || result.prefix} endpoint=${result.host}:${result.port} ok=false class=${result.errorCode || 'other'} error=${result.error || 'unknown'}`);
}

function installArkRconDiagnosticExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusArkRconDiagnosticLogin(...args) {
    const client = this;
    if (!client[BOUND]) {
      client[BOUND] = true;
      client.once(Events.ClientReady, () => {
        const previous = new Map();
        const run = async (reason) => {
          for (const prefix of PREFIXES) {
            const result = await probePrefix(prefix);
            if (result.skipped) continue;
            const next = signature(result);
            const prior = previous.get(prefix);
            if (reason === 'startup' || next !== prior) logResult(result, reason);
            previous.set(prefix, next);
          }
        };
        const initial = setTimeout(() => void run('startup').catch((error) => console.warn(`[Nexus Sentinal] ARK RCON diagnostic startup failed: ${String(error?.message || error).slice(0, 300)}`)), INITIAL_DELAY_MS);
        initial.unref?.();
        const timer = setInterval(() => void run('state-change').catch((error) => console.warn(`[Nexus Sentinal] ARK RCON diagnostic cycle failed: ${String(error?.message || error).slice(0, 300)}`)), INTERVAL_MS);
        timer.unref?.();
      });
    }
    return originalLogin.apply(this, args);
  };
}

module.exports = {
  PREFIXES,
  classifyRconError,
  probePrefix,
  signature,
  installArkRconDiagnosticExtension
};

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { Client, Events } = require('discord.js');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.restart.scheduler.extension');
const BOUND = Symbol.for('khaos.nexus.ark.restart.scheduler.bound');
const TIMER = Symbol.for('khaos.nexus.ark.restart.scheduler.timer');

const DEFAULT_TIME_ZONE = 'America/Chicago';
const DEFAULT_RESTART_HOUR = 6;
const DEFAULT_RESTART_MINUTE = 0;
const WARNING_SECONDS = [1800, 900, 600, 300, 180, 120, 60, 30, 10, 5, 4, 3, 2, 1];

function sleep(ms) { return new Promise((resolve) => setTimeout(resolve, ms)); }

function localParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const out = {};
  for (const part of parts) if (part.type !== 'literal') out[part.type] = part.value;
  return {
    year: Number(out.year), month: Number(out.month), day: Number(out.day),
    hour: Number(out.hour), minute: Number(out.minute), second: Number(out.second)
  };
}

function dayKey(parts) {
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

function secondsUntilRestart(parts, hour, minute) {
  const nowSeconds = parts.hour * 3600 + parts.minute * 60 + parts.second;
  const restartSeconds = hour * 3600 + minute * 60;
  return restartSeconds - nowSeconds;
}

function warningMessage(seconds) {
  if (seconds >= 60) {
    const minutes = Math.floor(seconds / 60);
    return `Khaos Nexus scheduled server restart in ${minutes} minute${minutes === 1 ? '' : 's'}. Please get to a safe location and finish important actions.`;
  }
  return `Khaos Nexus scheduled server restart in ${seconds} second${seconds === 1 ? '' : 's'}.`;
}

function auditPath() {
  const dir = process.env.NEXUS_DATA_DIR || '/app/data';
  return path.join(dir, 'ark-restart-audit.jsonl');
}

function audit(event, detail = {}) {
  const record = { at: new Date().toISOString(), event, ...detail };
  console.log(`[Nexus Sentinal] ARK restart ${event}: ${JSON.stringify(detail)}`);
  try {
    fs.mkdirSync(path.dirname(auditPath()), { recursive: true });
    fs.appendFileSync(auditPath(), `${JSON.stringify(record)}\n`, 'utf8');
  } catch (error) {
    console.warn(`[Nexus Sentinal] ARK restart audit write failed: ${String(error?.message || error).slice(0, 240)}`);
  }
}

function restartScheduleEnabled(prefix = 'ARK_GEN1') {
  return String(process.env[`${prefix}_RESTART_SCHEDULE_ENABLED`] || 'false').toLowerCase() === 'true';
}

async function waitForRecovery(server, { timeoutMs = 10 * 60_000, intervalMs = 15_000 } = {}) {
  const started = Date.now();
  let sawOffline = false;
  while (Date.now() - started < timeoutMs) {
    await sleep(intervalMs);
    const client = new ArkRconClient({ host: server.host, port: server.port, password: server.password, timeoutMs: 6000 });
    try {
      await client.execute('ListPlayers');
      if (sawOffline) {
        audit('recovery-complete', { server: server.name, elapsedMs: Date.now() - started });
        return true;
      }
    } catch (error) {
      if (!sawOffline) audit('offline-detected', { server: server.name, error: String(error?.message || error).slice(0, 240) });
      sawOffline = true;
    }
  }
  audit('recovery-timeout', { server: server.name, timeoutMs });
  return false;
}

async function performRestart(server) {
  const rcon = new ArkRconClient({ host: server.host, port: server.port, password: server.password, timeoutMs: 8000 });
  audit('save-requested', { server: server.name });
  await rcon.execute('SaveWorld');
  audit('save-complete', { server: server.name });
  await sleep(5000);

  audit('restart-requested', { server: server.name, method: 'rcon-doexit' });
  try {
    await rcon.execute('DoExit');
  } catch (error) {
    // A connection reset/close is expected when the game process exits.
    audit('restart-rcon-closed', { server: server.name, message: String(error?.message || error).slice(0, 240) });
  }
  void waitForRecovery(server).catch((error) => audit('recovery-error', { server: server.name, error: String(error?.message || error).slice(0, 240) }));
}

function installArkRestartSchedulerExtension({ prefix = 'ARK_GEN1' } = {}) {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusArkRestartSchedulerLogin(...args) {
    const client = this;
    if (!client[BOUND]) {
      client[BOUND] = true;
      client.once(Events.ClientReady, () => {
        const server = arkServerFromEnv(prefix);
        const enabled = restartScheduleEnabled(prefix);
        if (!server.enabled || !enabled) {
          audit('scheduler-disabled', { prefix, serverEnabled: server.enabled, scheduleEnabled: enabled });
          return;
        }
        if (!server.host || !server.port || !server.password) {
          audit('scheduler-unavailable', { prefix, reason: 'RCON variables incomplete' });
          return;
        }

        const timeZone = String(process.env[`${prefix}_RESTART_TIMEZONE`] || process.env.NEXUS_SCHEDULER_TIMEZONE || DEFAULT_TIME_ZONE);
        const restartHour = Math.min(23, Math.max(0, Number(process.env[`${prefix}_RESTART_HOUR`] ?? DEFAULT_RESTART_HOUR) || 0));
        const restartMinute = Math.min(59, Math.max(0, Number(process.env[`${prefix}_RESTART_MINUTE`] ?? DEFAULT_RESTART_MINUTE) || 0));
        let lastSecondKey = '';
        let restartRunning = false;
        const fired = new Set();

        audit('scheduler-started', {
          prefix,
          server: server.name,
          timeZone,
          restart: `${String(restartHour).padStart(2, '0')}:${String(restartMinute).padStart(2, '0')}`,
          warnings: WARNING_SECONDS
        });

        const tick = async () => {
          const parts = localParts(new Date(), timeZone);
          const secondKey = `${dayKey(parts)}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}`;
          if (secondKey === lastSecondKey) return;
          lastSecondKey = secondKey;

          const remaining = secondsUntilRestart(parts, restartHour, restartMinute);
          const today = dayKey(parts);
          for (const seconds of WARNING_SECONDS) {
            if (remaining !== seconds) continue;
            const key = `${today}:warn:${seconds}`;
            if (fired.has(key)) continue;
            fired.add(key);
            const message = warningMessage(seconds);
            try {
              const rcon = new ArkRconClient({ host: server.host, port: server.port, password: server.password, timeoutMs: 8000 });
              await rcon.execute(`Broadcast ${message}`);
              audit('warning-sent', { server: server.name, seconds, message });
            } catch (error) {
              audit('warning-failed', { server: server.name, seconds, error: String(error?.message || error).slice(0, 240) });
            }
          }

          if (remaining === 0 && !restartRunning) {
            const key = `${today}:restart`;
            if (fired.has(key)) return;
            fired.add(key);
            restartRunning = true;
            try {
              await performRestart(server);
            } catch (error) {
              audit('restart-failed', { server: server.name, error: String(error?.message || error).slice(0, 300) });
            } finally {
              restartRunning = false;
            }
          }

          // Keep memory bounded after local midnight.
          if (parts.hour === 0 && parts.minute === 10 && parts.second === 0) {
            for (const key of Array.from(fired)) if (!key.startsWith(`${today}:`)) fired.delete(key);
          }
        };

        client[TIMER] = setInterval(() => void tick(), 250);
        client[TIMER].unref?.();
        void tick();
      });
    }
    return originalLogin.apply(this, args);
  };
}

module.exports = {
  WARNING_SECONDS,
  localParts,
  secondsUntilRestart,
  warningMessage,
  restartScheduleEnabled,
  performRestart,
  waitForRecovery,
  installArkRestartSchedulerExtension
};

'use strict';

const BOT_STARTUP_TIMEOUT_MS = 45 * 1000;
const STARTUP_STATUSES = Object.freeze(new Set(['starting', 'connecting']));

function isStartupStatus(status) {
  return STARTUP_STATUSES.has(String(status || '').toLowerCase());
}

function startupTimeoutMessage(timeoutMs = BOT_STARTUP_TIMEOUT_MS) {
  const seconds = Math.max(1, Math.round(Number(timeoutMs || BOT_STARTUP_TIMEOUT_MS) / 1000));
  return `The Discord bot did not become ready within ${seconds} seconds. Check Live Logs and the Discord configuration before trying again.`;
}

module.exports = {
  BOT_STARTUP_TIMEOUT_MS,
  STARTUP_STATUSES,
  isStartupStatus,
  startupTimeoutMessage
};

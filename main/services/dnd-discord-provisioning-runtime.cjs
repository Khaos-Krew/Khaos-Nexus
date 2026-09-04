'use strict';

const {
  DndDiscordProvisioningService: BaseProvisioningService,
  DISCORD_API
} = require('./dnd-discord-provisioning-service.cjs');

function retryDelayMs(response, payload) {
  const headerValue = response?.headers?.get?.('retry-after');
  const headerDelay = headerValue === null || headerValue === undefined || headerValue === ''
    ? Number.NaN
    : Number(headerValue);
  const bodyDelay = Number(payload?.retry_after);
  const seconds = Number.isFinite(headerDelay)
    ? headerDelay
    : Number.isFinite(bodyDelay)
      ? bodyDelay
      : 1;
  return Math.max(0, seconds) * 1000;
}

function runtimeRequestError(status, body, fallback) {
  const error = new Error(body?.message || fallback || `Discord request failed with HTTP ${status}.`);
  error.status = status;
  error.discordCode = body?.code;
  if (status === 401) error.code = 'DISCORD_TOKEN_INVALID';
  else if (status === 403) error.code = 'DISCORD_PERMISSION_MISSING';
  else if (status === 404 && Number(body?.code) === 10003) error.code = 'DISCORD_RESOURCE_STALE';
  else if (status === 429) error.code = 'DISCORD_RATE_LIMITED';
  else error.code = 'DISCORD_REQUEST_FAILED';
  return error;
}

class DndDiscordProvisioningService extends BaseProvisioningService {
  constructor(options) {
    super(options);
    // Persistent campaign panels must use the same injected client, timeout,
    // rate-limit handling, and test transport as the provisioning operation.
    this.panelService.discord = this.discord.bind(this);
  }

  async discord(appId, path, { method = 'GET', body, attempts = 3 } = {}) {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      let response;
      try {
        response = await this.fetchImpl(`${DISCORD_API}${path}`, {
          method,
          headers: {
            Authorization: `Bot ${this.token(appId)}`,
            'Content-Type': 'application/json',
            'User-Agent': 'KhaosNexus-DnD-Provisioning/1.0'
          },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal
        });
      } catch (error) {
        clearTimeout(timeout);
        if (attempt < attempts && error?.name !== 'AbortError') {
          await this.sleep(250 * attempt);
          continue;
        }
        const wrapped = new Error(error?.name === 'AbortError'
          ? 'Discord provisioning request timed out.'
          : error.message || String(error));
        wrapped.code = error?.name === 'AbortError'
          ? 'DISCORD_REQUEST_TIMEOUT'
          : 'DISCORD_REQUEST_FAILED';
        throw wrapped;
      }
      clearTimeout(timeout);

      const text = await response.text();
      let payload = null;
      try { payload = text ? JSON.parse(text) : null; }
      catch { payload = text; }

      if (response.ok) return payload;
      if (response.status === 429 && attempt < attempts) {
        await this.sleep(retryDelayMs(response, payload));
        continue;
      }
      if (response.status >= 500 && attempt < attempts) {
        await this.sleep(300 * attempt);
        continue;
      }
      throw runtimeRequestError(response.status, payload, `Discord request to ${path} failed.`);
    }
    throw runtimeRequestError(500, null, 'Discord request exhausted its retry attempts.');
  }
}

module.exports = {
  DndDiscordProvisioningService,
  retryDelayMs,
  runtimeRequestError
};

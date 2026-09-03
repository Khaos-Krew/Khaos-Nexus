'use strict';

const {
  DndDiscordProvisioningService: BaseProvisioningService,
  DISCORD_API,
  requestError
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

function provisioningFailures(results) {
  return (Array.isArray(results) ? results : []).filter((item) =>
    item?.status === 'failed' || item?.status === 'binding-failed'
  );
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
      throw requestError(response.status, payload, `Discord request to ${path} failed.`);
    }
    throw requestError(500, null, 'Discord request exhausted its retry attempts.');
  }

  async apply(input = {}, onProgress = () => {}) {
    // The base service historically counted failures before refreshing the
    // persistent campaign panel. Buffer the terminal event so callers only
    // receive the final, reconciled provisioning outcome.
    let terminalProgress = null;
    const result = await super.apply(input, (event) => {
      if (event?.phase === 'complete') {
        terminalProgress = event;
        return;
      }
      onProgress(event);
    });

    const failures = provisioningFailures(result?.results);
    const failedCount = failures.length;
    const previousFailedCount = Number(result?.failedCount || 0);
    let record = result?.record || null;

    if (failedCount !== previousFailedCount) {
      if (record && record.status !== 'partial') {
        record = this.saveRecord({ ...record, status: 'partial' });
      }

      this.audit('provisioning.outcome_reconciled', {
        ...input,
        campaignId: result?.preview?.campaign?.id || input.campaignId,
        appId: result?.preview?.appId || input.appId,
        guildId: result?.preview?.guildId || input.guildId,
        targetId: record?.id || ''
      }, failedCount ? 'partial' : 'success', {
        previousFailedCount,
        failedCount,
        failureKeys: failures.map((item) => item.key || 'unknown')
      });
    }

    const finalStatus = failedCount ? 'partial' : 'success';
    onProgress({
      ...(terminalProgress || {}),
      phase: 'complete',
      status: finalStatus,
      createdCount: Number(result?.createdCount || terminalProgress?.createdCount || 0),
      failedCount
    });

    return {
      ...result,
      record,
      failedCount
    };
  }
}

module.exports = {
  DndDiscordProvisioningService,
  retryDelayMs,
  provisioningFailures
};

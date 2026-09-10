'use strict';

const { loadSentinelConfig } = require('./config.cjs');
const { createLogger } = require('./logger.cjs');
const { DiscordShadowAdapter } = require('./discord-shadow-adapter.cjs');

async function startShadow() {
  const base = loadSentinelConfig();
  const config = Object.freeze({
    ...base,
    mode: 'shadow',
    serviceName: process.env.NEXUS_SENTINEL_SHADOW_NAME || 'nexus-sentinel-shadow',
    mutationEnabled: false,
    dryRun: true,
  });
  const logger = createLogger({ service: config.serviceName, level: config.logLevel });
  const discord = new DiscordShadowAdapter({
    token: config.discordToken,
    guildId: config.guildId,
    logger,
  });

  const initialSnapshot = await discord.start();
  logger.info('sentinel.shadow.started', {
    mutationEnabled: false,
    dryRun: true,
    guildId: initialSnapshot.guildId,
    guildFingerprint: initialSnapshot.fingerprint,
  });

  const shutdown = async (signal) => {
    logger.info('sentinel.shadow.shutdown', { signal });
    await discord.stop();
  };

  return Object.freeze({ config, logger, discord, initialSnapshot, shutdown });
}

if (require.main === module) {
  startShadow()
    .then((runtime) => {
      let stopping = false;
      const stop = async (signal) => {
        if (stopping) return;
        stopping = true;
        await runtime.shutdown(signal);
        process.exit(0);
      };
      process.once('SIGTERM', () => void stop('SIGTERM'));
      process.once('SIGINT', () => void stop('SIGINT'));
    })
    .catch((error) => {
      console.error(JSON.stringify({
        ts: new Date().toISOString(),
        level: 'error',
        service: 'nexus-sentinel-shadow',
        message: 'sentinel.shadow.fatal',
        error: { message: String(error.message || error) },
      }));
      process.exitCode = 1;
    });
}

module.exports = { startShadow };

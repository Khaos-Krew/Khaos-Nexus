'use strict';

const { version: forgeIntegrationVersion } = require('../../package.json');

function logForgeDiscordBridgeInstalled(logger = console) {
  logger.log?.(`[Nexus Sentinal] Forge Discord bridge installed (integration v${forgeIntegrationVersion}).`);
}

module.exports = {
  forgeIntegrationVersion,
  logForgeDiscordBridgeInstalled
};

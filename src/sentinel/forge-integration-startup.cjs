'use strict';

const { version: FORGE_INTEGRATION_VERSION } = require('../../package.json');

function forgeIntegrationStartupText() {
  return `[Nexus Sentinal] Forge Discord bridge installed (integration version ${FORGE_INTEGRATION_VERSION}).`;
}

function logForgeIntegrationInstalled(logger = console) {
  logger.log?.(forgeIntegrationStartupText());
}

module.exports = {
  FORGE_INTEGRATION_VERSION,
  forgeIntegrationStartupText,
  logForgeIntegrationInstalled
};

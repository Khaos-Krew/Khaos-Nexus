'use strict';

let installed = false;

function install() {
  if (installed) return;
  installed = true;
  const target = require('./services/config-store.cjs');
  const prototype = target.ConfigStore?.prototype;
  if (!prototype || prototype.__khaosRconValidationPatched) return;
  const original = prototype.upsertServer;
  prototype.upsertServer = function validatedServerSave(server = {}, password) {
    const game = String(server.game || 'generic').toLowerCase();
    const palworldRest = game === 'palworld' && String(server.connectionType || 'rest').toLowerCase() !== 'rcon';
    if (!palworldRest) {
      const { normalizeRconEndpoint } = require('../bot/rcon.cjs');
      const endpoint = normalizeRconEndpoint(server.host, server.port);
      server = { ...server, host: endpoint.host, port: endpoint.port };
    }
    return original.call(this, server, password);
  };
  Object.defineProperty(prototype, '__khaosRconValidationPatched', { value: true });
}

module.exports = { install };

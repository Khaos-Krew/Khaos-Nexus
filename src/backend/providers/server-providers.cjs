'use strict';

const { envSecret } = require('../../shared/config.cjs');
const { SourceRconProvider } = require('./source-rcon-provider.cjs');
const { PalworldProvider } = require('./palworld-provider.cjs');
const { RustProvider } = require('./rust-provider.cjs');
const { SatisfactoryProvider } = require('./satisfactory-provider.cjs');

function env(name) {
  return String(process.env[name] || '').trim();
}

function passwordFor(connection = {}, defaultEnv = '') {
  return String(connection.password || envSecret(connection.passwordEnv) || env(defaultEnv) || '');
}

function configuredConnection(moduleConfig = {}, defaults = {}) {
  const source = moduleConfig.connection && typeof moduleConfig.connection === 'object' ? moduleConfig.connection : {};
  const host = String(source.host || env(defaults.hostEnv) || '').trim();
  const port = Number(source.port || env(defaults.portEnv) || 0);
  const password = passwordFor(source, defaults.passwordEnv);
  if (!host || !Number.isInteger(port) || port < 1 || port > 65535 || !password) return null;
  return { ...source, host, port, password };
}

function serverProvidersFromConfig(config = {}) {
  const providers = {};

  const ark = configuredConnection(config.modules?.ark, {
    hostEnv: 'NEXUS_ARK_RCON_HOST',
    portEnv: 'NEXUS_ARK_RCON_PORT',
    passwordEnv: 'NEXUS_ARK_RCON_PASSWORD'
  });
  if (config.modules?.ark?.enabled !== false && ark) providers.ark = new SourceRconProvider('ark', ark);

  const minecraft = configuredConnection(config.modules?.minecraft, {
    hostEnv: 'NEXUS_MINECRAFT_RCON_HOST',
    portEnv: 'NEXUS_MINECRAFT_RCON_PORT',
    passwordEnv: 'NEXUS_MINECRAFT_RCON_PASSWORD'
  });
  if (config.modules?.minecraft?.enabled !== false && minecraft) providers.minecraft = new SourceRconProvider('minecraft', minecraft);

  const palworld = configuredConnection(config.modules?.palworld, {
    hostEnv: 'NEXUS_PALWORLD_REST_HOST',
    portEnv: 'NEXUS_PALWORLD_REST_PORT',
    passwordEnv: 'NEXUS_PALWORLD_REST_PASSWORD'
  });
  if (config.modules?.palworld?.enabled !== false && palworld) {
    providers.palworld = new PalworldProvider({
      ...palworld,
      protocol: palworld.protocol || env('NEXUS_PALWORLD_REST_PROTOCOL') || 'http',
      apiPath: palworld.apiPath || env('NEXUS_PALWORLD_REST_API_PATH') || '/v1/api',
      username: palworld.username || env('NEXUS_PALWORLD_REST_USERNAME') || 'admin'
    });
  }

  const rust = configuredConnection(config.modules?.rust, {
    hostEnv: 'NEXUS_RUST_RCON_HOST',
    portEnv: 'NEXUS_RUST_RCON_PORT',
    passwordEnv: 'NEXUS_RUST_RCON_PASSWORD'
  });
  if (config.modules?.rust?.enabled !== false && rust) {
    providers.rust = new RustProvider({
      ...rust,
      protocol: rust.protocol || env('NEXUS_RUST_RCON_PROTOCOL') || 'ws',
      rconName: rust.rconName || 'Khaos Nexus'
    });
  }

  const satisfactory = configuredConnection(config.modules?.satisfactory, {
    hostEnv: 'NEXUS_SATISFACTORY_HOST',
    portEnv: 'NEXUS_SATISFACTORY_PORT',
    passwordEnv: 'NEXUS_SATISFACTORY_TOKEN'
  });
  if (config.modules?.satisfactory?.enabled !== false && satisfactory) {
    providers.satisfactory = new SatisfactoryProvider({
      ...satisfactory,
      tlsFingerprint: satisfactory.tlsFingerprint || env('NEXUS_SATISFACTORY_TLS_FINGERPRINT')
    });
  }

  return providers;
}

module.exports = { serverProvidersFromConfig, configuredConnection, passwordFor };

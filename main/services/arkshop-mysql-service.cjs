'use strict';

const net = require('node:net');

function parseHandshake(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 8) throw new Error('MySQL endpoint returned an invalid handshake.');
  const payloadLength = buffer.readUIntLE(0, 3);
  if (payloadLength < 4 || buffer.length < 5) throw new Error('MySQL endpoint returned a truncated handshake.');
  const protocolVersion = buffer[4];
  const end = buffer.indexOf(0x00, 5);
  const serverVersion = end > 5 ? buffer.subarray(5, end).toString('utf8') : 'unknown';
  return { protocolVersion, serverVersion };
}

class ArkShopMysqlService {
  constructor({ configStore, now = () => Date.now() } = {}) {
    this.configStore = configStore;
    this.now = now;
  }

  config(serverId) {
    const runtime = this.configStore?.getArkShopMysqlRuntime?.(serverId);
    if (!runtime?.host || !runtime?.database || !runtime?.user) {
      throw new Error('ArkShop MySQL host, database, and user must be configured before database checks can run.');
    }
    return runtime;
  }

  async probe(serverId) {
    const config = this.config(serverId);
    const started = this.now();
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: config.host, port: config.port });
      const timeout = setTimeout(() => {
        socket.destroy();
        reject(new Error(`ArkShop MySQL connection timed out after ${config.connectTimeoutMs} ms.`));
      }, config.connectTimeoutMs);
      timeout.unref?.();

      const finish = (error, value) => {
        clearTimeout(timeout);
        socket.destroy();
        if (error) reject(error);
        else resolve(value);
      };

      socket.once('error', (error) => finish(new Error(`ArkShop MySQL connection failed: ${error.message}`)));
      socket.once('data', (buffer) => {
        try {
          const handshake = parseHandshake(buffer);
          finish(null, {
            online: true,
            host: config.host,
            port: config.port,
            database: config.database,
            user: config.user,
            sslConfigured: config.ssl,
            passwordConfigured: Boolean(config.password),
            protocolVersion: handshake.protocolVersion,
            serverVersion: handshake.serverVersion,
            latencyMs: Math.max(0, this.now() - started),
            mode: 'handshake-only'
          });
        } catch (error) {
          finish(error);
        }
      });
    });
  }
}

module.exports = { ArkShopMysqlService, parseHandshake };
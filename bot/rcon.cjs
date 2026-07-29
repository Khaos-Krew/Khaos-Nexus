'use strict';

const net = require('node:net');
const { encodePacket, decodePackets } = require('../shared/rcon-protocol.cjs');

function normalizeRconEndpoint(hostInput, portInput) {
  let host = String(hostInput || '').trim();
  const port = Number(portInput);
  if (!host) throw new Error('RCON host is required.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('RCON port must be a number between 1 and 65535.');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host)) throw new Error('Enter only the RCON hostname or IP address, without http:// or https://.');

  const bracketed = /^\[([^\]]+)\]$/.exec(host);
  if (bracketed) {
    if (net.isIP(bracketed[1]) !== 6) throw new Error('The bracketed RCON host is not a valid IPv6 address.');
    host = bracketed[1];
  } else if (net.isIP(host) !== 6 && /:\d+$/.test(host)) {
    throw new Error('Do not include the port in the RCON host field. Enter the host and port in their separate fields.');
  }

  if (/\s/.test(host) || /[\\/]/.test(host)) throw new Error('RCON host must be a hostname or IP address without spaces or path characters.');
  return { host, port };
}

class SourceRcon {
  constructor({ host, port, password, timeoutMs = 7000 }) {
    const endpoint = normalizeRconEndpoint(host, port);
    this.host = endpoint.host;
    this.port = endpoint.port;
    this.password = password;
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || 7000);
  }

  execute(command) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      let buffer = Buffer.alloc(0);
      let connected = false;
      let authenticated = false;
      let finished = false;
      let response = '';
      const authId = 1;
      const commandId = 100;
      const terminatorId = 101;
      let idleTimer = null;

      const cleanup = () => {
        clearTimeout(overallTimer);
        clearTimeout(idleTimer);
        socket.removeAllListeners();
        if (!socket.destroyed) socket.destroy();
      };

      const finish = (error, value) => {
        if (finished) return;
        finished = true;
        cleanup();
        if (error) reject(error);
        else resolve(value);
      };

      const armIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          if (authenticated && response.length > 0) finish(null, response.trim());
        }, 600);
      };

      const overallTimer = setTimeout(() => {
        const phase = !connected ? 'connecting to the RCON endpoint' : !authenticated ? 'waiting for RCON authentication' : 'waiting for the command response';
        finish(new Error(`RCON request timed out after ${this.timeoutMs}ms while ${phase}. Confirm RCON is enabled and that this is the RCON port, not the game or query port.`));
      }, this.timeoutMs);

      socket.setNoDelay(true);
      socket.setTimeout(this.timeoutMs);

      socket.on('connect', () => {
        connected = true;
        socket.write(encodePacket(authId, 3, this.password));
      });

      socket.on('data', (chunk) => {
        try {
          buffer = Buffer.concat([buffer, chunk]);
          const decoded = decodePackets(buffer);
          buffer = decoded.remaining;

          for (const packet of decoded.packets) {
            if (!authenticated) {
              if (packet.requestId === -1) {
                finish(new Error('RCON authentication failed. Verify the RCON/Admin password for this server.'));
                return;
              }
              if (packet.requestId === authId && packet.type === 2) {
                authenticated = true;
                socket.write(encodePacket(commandId, 2, command));
                socket.write(encodePacket(terminatorId, 2, ''));
              }
              continue;
            }

            if (packet.requestId === commandId) {
              response += packet.body;
              armIdle();
            } else if (packet.requestId === terminatorId) {
              finish(null, response.trim());
              return;
            }
          }
        } catch (error) {
          finish(error);
        }
      });

      socket.on('timeout', () => finish(new Error('RCON socket timed out. Confirm RCON is enabled and use the server RCON port rather than its game or query port.')));
      socket.on('error', (error) => {
        if (error?.code === 'ENOTFOUND') {
          finish(new Error('RCON host could not be resolved. Enter only the hostname or IP address in the host field and keep the port in the separate port field.'));
          return;
        }
        if (error?.code === 'ECONNREFUSED') {
          finish(new Error('RCON connection was refused. Confirm RCON is enabled and that the configured RCON port is correct.'));
          return;
        }
        finish(new Error(`RCON connection failed: ${error.message}`));
      });
      socket.on('end', () => {
        if (finished) return;
        if (authenticated && response) finish(null, response.trim());
        else if (!authenticated) finish(new Error('RCON connection closed before authentication. Confirm RCON is enabled, use the RCON port rather than the game/query port, and verify the password.'));
        else finish(new Error('RCON authenticated, but the server closed the connection before returning a command response.'));
      });
    });
  }
}

module.exports = { SourceRcon, normalizeRconEndpoint };

'use strict';

const net = require('node:net');
const { encodePacket, decodePackets } = require('./rcon-protocol.cjs');

function normalizeRconEndpoint(hostInput, portInput) {
  let host = String(hostInput || '').trim();
  const port = Number(portInput);
  if (!host) throw new Error('RCON host is required.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('RCON port must be between 1 and 65535.');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(host)) throw new Error('Enter only the RCON hostname or IP address, without a protocol.');
  const bracketed = /^\[([^\]]+)\]$/.exec(host);
  if (bracketed) {
    if (net.isIP(bracketed[1]) !== 6) throw new Error('The bracketed RCON host is not valid IPv6.');
    host = bracketed[1];
  } else if (net.isIP(host) !== 6 && /:\d+$/.test(host)) {
    throw new Error('Keep the RCON host and port in separate fields.');
  }
  if (/\s/.test(host) || /[\\/]/.test(host)) throw new Error('RCON host must be a hostname or IP address.');
  return { host, port };
}

class SourceRcon {
  constructor({ host, port, password, timeoutMs = 7000 }) {
    const endpoint = normalizeRconEndpoint(host, port);
    this.host = endpoint.host;
    this.port = endpoint.port;
    this.password = String(password || '');
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || 7000);
    if (!this.password) throw new Error('RCON password is required.');
  }

  execute(commandInput) {
    const command = String(commandInput || '').replace(/\u0000/g, '').trim();
    if (!command) return Promise.reject(new Error('RCON command is required.'));
    if (command.length > 2000 || /[\r\n]/.test(command)) return Promise.reject(new Error('RCON command must be a single line under 2,000 characters.'));

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
        else resolve(String(value || '').trim());
      };
      const armIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
          if (authenticated && response.length > 0) finish(null, response);
        }, 600);
      };
      const overallTimer = setTimeout(() => {
        const phase = !connected ? 'connecting' : !authenticated ? 'authenticating' : 'waiting for a response';
        finish(new Error(`RCON request timed out while ${phase}. Confirm the RCON host, port, password, and that RCON is enabled.`));
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
              if (packet.requestId === -1) return finish(new Error('RCON authentication failed. Verify the configured password.'));
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
              return finish(null, response);
            }
          }
        } catch (error) {
          finish(error);
        }
      });
      socket.on('timeout', () => finish(new Error('RCON socket timed out.')));
      socket.on('error', (error) => {
        if (error?.code === 'ENOTFOUND') return finish(new Error('RCON host could not be resolved.'));
        if (error?.code === 'ECONNREFUSED') return finish(new Error('RCON connection was refused. Confirm the RCON port and that RCON is enabled.'));
        finish(new Error(`RCON connection failed: ${error.message}`));
      });
      socket.on('end', () => {
        if (finished) return;
        if (authenticated && response) finish(null, response);
        else if (!authenticated) finish(new Error('RCON connection closed before authentication.'));
        else finish(new Error('RCON connection closed before a command response was returned.'));
      });
    });
  }
}

module.exports = { SourceRcon, normalizeRconEndpoint };

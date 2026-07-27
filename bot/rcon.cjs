'use strict';

const net = require('node:net');
const { encodePacket, decodePackets } = require('../shared/rcon-protocol.cjs');

class SourceRcon {
  constructor({ host, port, password, timeoutMs = 7000 }) {
    this.host = host;
    this.port = Number(port);
    this.password = password;
    this.timeoutMs = timeoutMs;
  }

  execute(command) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      let buffer = Buffer.alloc(0);
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
        finish(new Error(`RCON request timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);

      socket.setNoDelay(true);
      socket.setTimeout(this.timeoutMs);

      socket.on('connect', () => {
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
                finish(new Error('RCON authentication failed'));
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

      socket.on('timeout', () => finish(new Error('RCON socket timed out')));
      socket.on('error', (error) => finish(new Error(`RCON connection failed: ${error.message}`)));
      socket.on('end', () => {
        if (!finished) {
          if (authenticated && response) finish(null, response.trim());
          else finish(new Error('RCON connection closed before a response was received'));
        }
      });
    });
  }
}

module.exports = { SourceRcon };

'use strict';

const net = require('node:net');

function packet(id, type, body = '') {
  const text = Buffer.from(String(body), 'utf8');
  const payload = Buffer.alloc(10 + text.length);
  payload.writeInt32LE(id, 0);
  payload.writeInt32LE(type, 4);
  text.copy(payload, 8);
  payload.writeInt16LE(0, 8 + text.length);
  const out = Buffer.alloc(4 + payload.length);
  out.writeInt32LE(payload.length, 0);
  payload.copy(out, 4);
  return out;
}

function decode(buffer) {
  const packets = [];
  let offset = 0;
  while (buffer.length - offset >= 4) {
    const size = buffer.readInt32LE(offset);
    if (size < 10 || buffer.length - offset < size + 4) break;
    const start = offset + 4;
    const id = buffer.readInt32LE(start);
    const type = buffer.readInt32LE(start + 4);
    const body = buffer.subarray(start + 8, start + size - 2).toString('utf8');
    packets.push({ id, type, body });
    offset += size + 4;
  }
  return { packets, remaining: buffer.subarray(offset) };
}

class ArkRconClient {
  constructor({ host, port, password, timeoutMs = 8000 } = {}) {
    this.host = String(host || '').trim();
    this.port = Number(port);
    this.password = String(password || '');
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || 8000);
    if (!this.host) throw new Error('ARK RCON host is missing.');
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535) throw new Error('ARK RCON port is invalid.');
    if (!this.password) throw new Error('ARK RCON password is missing.');
  }

  execute(command) {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: this.host, port: this.port });
      let buffer = Buffer.alloc(0);
      let connected = false;
      let authenticated = false;
      let commandSent = false;
      let response = '';
      let finished = false;
      let idleTimer = null;
      const authId = 1;
      const commandId = 10;

      const cleanup = () => {
        clearTimeout(timer);
        clearTimeout(idleTimer);
        socket.removeAllListeners();
        if (!socket.destroyed) socket.destroy();
      };
      const finish = (error, value = '') => {
        if (finished) return;
        finished = true;
        cleanup();
        if (error) reject(error); else resolve(String(value || '').trim());
      };
      const armIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => finish(null, response), 700);
      };
      const timeoutMessage = () => {
        if (!connected) return 'ARK RCON TCP connection timed out. Confirm the host and RCON port are reachable.';
        if (!authenticated) return 'ARK RCON authentication response timed out. The TCP port accepted the connection but the server did not answer RCON authentication.';
        if (commandSent) return 'ARK RCON command response timed out after authentication.';
        return 'ARK RCON request timed out.';
      };
      const timer = setTimeout(() => finish(new Error(timeoutMessage())), this.timeoutMs);

      socket.setNoDelay(true);
      socket.on('connect', () => {
        connected = true;
        socket.write(packet(authId, 3, this.password));
      });
      socket.on('data', (chunk) => {
        try {
          buffer = Buffer.concat([buffer, chunk]);
          const parsed = decode(buffer);
          buffer = parsed.remaining;
          for (const item of parsed.packets) {
            if (!authenticated) {
              if (item.id === -1) return finish(new Error('ARK RCON authentication failed.'));
              if (item.id === authId && item.type === 2) {
                authenticated = true;
                commandSent = true;
                socket.write(packet(commandId, 2, command));
              }
              continue;
            }
            if (item.id === commandId) {
              response += item.body;
              armIdle();
            }
          }
        } catch (error) {
          finish(error);
        }
      });
      socket.on('error', (error) => finish(new Error(`ARK RCON connection failed: ${error.message}`)));
      socket.on('end', () => finish(authenticated ? null : new Error('ARK RCON closed before authentication.'), response));
    });
  }
}

function arkServerFromEnv(prefix = 'ARK_GEN1') {
  return {
    id: prefix.toLowerCase(),
    name: String(process.env[`${prefix}_NAME`] || prefix),
    host: String(process.env[`${prefix}_HOST`] || ''),
    port: Number(process.env[`${prefix}_RCON_PORT`] || 0),
    password: String(process.env[`${prefix}_RCON_PASSWORD`] || ''),
    enabled: String(process.env[`${prefix}_ENABLED`] || 'false').toLowerCase() === 'true'
  };
}

module.exports = { ArkRconClient, arkServerFromEnv, packet, decode };

'use strict';

const net = require('node:net');
const { resolveRconServer } = require('./ark-rcon-config-store.cjs');

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
  constructor({ host, port, password, prefix, provider, timeoutMs = 8000, responseWindowMs = 1500 } = {}) {
    const { databaseMode, getRconConfigProvider } = require('./ark-rcon-database.cjs');
    this.prefix = prefix;
    this.provider = provider || (prefix && databaseMode() ? getRconConfigProvider() : null);
    this.host = String(host || '').trim();
    this.port = Number(port);
    this.password = String(password || '');
    this.timeoutMs = Math.max(1000, Number(timeoutMs) || 8000);
    this.responseWindowMs = Math.max(500, Math.min(5000, Number(responseWindowMs) || 1500));
    if (this.provider) return;
    if (!this.host) throw new Error('ARK RCON host is missing.');
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535) throw new Error('ARK RCON port is invalid.');
    if (!this.password) throw new Error('ARK RCON password is missing.');
  }

  async execute(command) {
    const result = await this.executeDetailed(command);
    return result.response;
  }

  executeDetailed(command) {
    if (this.provider) {
      return Promise.resolve().then(() => this.provider.resolve(this.prefix)).then((server) => {
        if (!server.enabled) throw new Error('ARK RCON target is disabled.');
        // A fresh transport prevents concurrent requests sharing mutable credentials.
        return new ArkRconClient({ prefix: server.prefix, host: server.host, port: server.port, password: server.password,
          timeoutMs: server.timeoutMs, responseWindowMs: this.responseWindowMs }).executeDetailed(command);
      });
    }
    const commandText = String(command ?? '');
    if (!commandText.trim()) return Promise.reject(new Error('ARK RCON command is empty.'));

    return new Promise((resolve, reject) => {
      const startedAt = Date.now();
      const socket = net.createConnection({ host: this.host, port: this.port });
      let buffer = Buffer.alloc(0);
      let connected = false;
      let authenticated = false;
      let commandSent = false;
      let response = '';
      let responsePackets = 0;
      let finished = false;
      let idleTimer = null;
      let noReplyTimer = null;
      const authId = 1;
      const commandId = 10;

      const cleanup = () => {
        clearTimeout(timer);
        clearTimeout(idleTimer);
        clearTimeout(noReplyTimer);
        socket.removeAllListeners();
        if (!socket.destroyed) socket.destroy();
      };
      const finish = (error, result = null) => {
        if (finished) return;
        finished = true;
        cleanup();
        if (error) {
          error.commandSent = commandSent;
          error.authenticated = authenticated;
          reject(error);
          return;
        }
        const status = result?.status || (responsePackets > 0 ? (response ? 'reply_received' : 'sent_blank_reply') : 'sent_no_reply');
        resolve({
          status,
          response: String(result?.response ?? response ?? '').trim(),
          packets: Number(result?.packets ?? responsePackets) || 0,
          elapsedMs: Date.now() - startedAt,
          authenticated,
          commandSent
        });
      };
      const armIdle = () => {
        clearTimeout(idleTimer);
        idleTimer = setTimeout(() => finish(null), 700);
      };
      const armNoReply = () => {
        clearTimeout(noReplyTimer);
        noReplyTimer = setTimeout(() => finish(null, { status: 'sent_no_reply', response: '', packets: 0 }), this.responseWindowMs);
      };
      const timeoutMessage = () => {
        if (!connected) return 'ARK RCON TCP connection timed out. Confirm the host and RCON port are reachable.';
        if (!authenticated) return 'ARK RCON authentication response timed out. The TCP port accepted the connection but the server did not answer RCON authentication.';
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
                socket.write(packet(commandId, 2, commandText));
                armNoReply();
              }
              continue;
            }
            if (item.id === commandId) {
              clearTimeout(noReplyTimer);
              responsePackets += 1;
              response += item.body;
              armIdle();
            }
          }
        } catch (error) {
          finish(error);
        }
      });
      socket.on('error', (error) => finish(new Error(`ARK RCON connection failed: ${error.message}`)));
      socket.on('end', () => {
        if (!authenticated) return finish(new Error('ARK RCON closed before authentication.'));
        finish(null);
      });
    });
  }
}

function arkServerFromEnv(prefix = 'ARK_GEN1', env = process.env) {
  if (require('./ark-rcon-database.cjs').databaseMode(env)) {
    const key = require('./ark-rcon-config-store.cjs').normalizePrefix(prefix);
    // Synchronous callers receive a reference, never cached database credentials.
    // Enabled/configured are checked authoritatively by the provider at execution.
    return { prefix: key, id: key.toLowerCase(), name: String(env[`${key}_NAME`] || key),
      host: '', port: 0, password: '', enabled: true, source: 'postgres', timeoutMs: 8000 };
  }
  return resolveRconServer(prefix, env);
}

function rconConfigured(server) {
  return Boolean(server?.prefix && require('./ark-rcon-database.cjs').databaseMode()) || Boolean(server?.host && server?.port && server?.password);
}

module.exports = { ArkRconClient, arkServerFromEnv, rconConfigured, packet, decode };

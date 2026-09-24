'use strict';

const dgram = require('node:dgram');
const net = require('node:net');
const { normalizeRconEndpoint } = require('../backend/transports/source-rcon.cjs');
const {
  encodeJavaHandshake,
  encodeJavaStatusRequest,
  encodeUnconnectedPing,
  parseBedrockPong,
  parseJavaStatusPacket,
  redactSecret
} = require('./protocol.cjs');

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    if (typeof timer.unref === 'function') timer.unref();
    promise.then((value) => {
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

function pingJava(host, port = 25565, timeoutMs = 4000) {
  const endpoint = normalizeRconEndpoint(host, port);
  const timeout = Math.max(500, Math.min(15000, Number(timeoutMs) || 4000));
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: endpoint.host, port: endpoint.port });
    let buffer = Buffer.alloc(0);
    let finished = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      if (!socket.destroyed) socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('Java status ping timed out.')), timeout);
    socket.setTimeout(timeout);
    socket.once('connect', () => {
      socket.write(encodeJavaHandshake(endpoint.host, endpoint.port));
      socket.write(encodeJavaStatusRequest());
    });
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        finish(null, parseJavaStatusPacket(buffer));
      } catch (error) {
        if (!/Incomplete/.test(String(error?.message || ''))) finish(error);
      }
    });
    socket.on('timeout', () => finish(new Error('Java status ping timed out.')));
    socket.on('error', (error) => {
      if (error?.code === 'ENOTFOUND') return finish(new Error('Java status host could not be resolved.'));
      if (error?.code === 'ECONNREFUSED') return finish(new Error('Java status connection was refused.'));
      finish(new Error('Java status ping failed.'));
    });
    socket.on('end', () => {
      if (!finished) finish(new Error('Java status ping closed before a response.'));
    });
  });
}

function pingBedrock(host, port = 19132, timeoutMs = 4000) {
  const endpoint = normalizeRconEndpoint(host, port);
  const timeout = Math.max(500, Math.min(15000, Number(timeoutMs) || 4000));
  return new Promise((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    let finished = false;
    const finish = (error, value) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      socket.removeAllListeners();
      try { socket.close(); } catch {}
      if (error) reject(error);
      else resolve(value);
    };
    const timer = setTimeout(() => finish(new Error('Bedrock status ping timed out.')), timeout);
    socket.once('message', (message) => {
      try {
        finish(null, parseBedrockPong(message));
      } catch (error) {
        finish(error);
      }
    });
    socket.once('error', () => finish(new Error('Bedrock status ping failed.')));
    socket.send(encodeUnconnectedPing(), endpoint.port, endpoint.host, (error) => {
      if (error) finish(new Error('Bedrock status ping failed.'));
    });
  });
}

async function runRcon(server, command) {
  const timeoutMs = Math.max(1000, Math.min(30000, Number(server?.timeoutMs) || 8000));
  const { SourceRcon } = require('../backend/transports/source-rcon.cjs');
  const client = new SourceRcon({
    host: server.host,
    port: server.port,
    password: server.password,
    timeoutMs
  });
  try {
    return await withTimeout(client.execute(command), timeoutMs + 500, 'Minecraft RCON timed out.');
  } catch (error) {
    throw new Error(redactSecret(error?.message || error, [server?.password]));
  }
}

function playerName(value) {
  const name = String(value || '').trim();
  if (!/^[A-Za-z0-9_.]{1,32}$/.test(name)) throw new Error('Player name must be letters, numbers, underscore, or dot.');
  return name;
}

function singleLine(value, max) {
  const text = String(value || '').replace(/[\u0000\r\n]/g, ' ').replace(/[ \t]{2,}/g, ' ').trim();
  if (!text) throw new Error('That text is empty.');
  if (text.length > max) throw new Error('That text is too long.');
  return text;
}

function minecraftCommand(kind, args = {}) {
  if (kind === 'list') return 'list';
  if (kind === 'say') return `say ${singleLine(args.message, 200)}`;
  if (kind === 'whitelist-add') return `whitelist add ${playerName(args.name)}`;
  if (kind === 'whitelist-remove') return `whitelist remove ${playerName(args.name)}`;
  if (kind === 'whitelist-list') return 'whitelist list';
  if (kind === 'kick') {
    const reason = String(args.reason || '').trim();
    return reason ? `kick ${playerName(args.name)} ${singleLine(reason, 100)}` : `kick ${playerName(args.name)}`;
  }
  if (kind === 'raw') return singleLine(args.command, 1000);
  throw new Error('Unknown Minecraft command.');
}

module.exports = {
  withTimeout,
  pingJava,
  pingBedrock,
  runRcon,
  playerName,
  minecraftCommand
};

'use strict';

const { encodePacket, decodePackets } = require('../backend/transports/rcon-protocol.cjs');

// Offline RakNet magic. Unconnected ping is id, time, magic, guid.
// Unconnected pong is id, time, guid, magic, big-endian length, MOTD string.
const RAKNET_MAGIC = Buffer.from('00ffff00fefefefefdfdfdfd12345678', 'hex');
const UNCONNECTED_PING = 0x01;
const UNCONNECTED_PONG = 0x1c;
const JAVA_STATUS_PROTOCOL = 767;

function encodeRconPacket(requestId, type, body = '') {
  return encodePacket(requestId, type, body);
}

function decodeRconPackets(buffer) {
  return decodePackets(buffer);
}

function redactSecret(text, secrets = []) {
  let out = String(text ?? '');
  const values = Array.isArray(secrets) ? secrets : [secrets];
  for (const secret of values) {
    const value = String(secret || '');
    if (value.length < 4 || !out.includes(value)) continue;
    out = out.split(value).join('[redacted]');
  }
  return out;
}

function writeVarInt(value) {
  let num = value >>> 0;
  const bytes = [];
  do {
    let next = num & 0x7f;
    num >>>= 7;
    if (num !== 0) next |= 0x80;
    bytes.push(next);
  } while (num !== 0);
  return Buffer.from(bytes);
}

function readVarInt(buffer, offset) {
  let value = 0;
  let shift = 0;
  let pos = offset;
  while (pos < buffer.length && shift <= 35) {
    const byte = buffer[pos];
    pos += 1;
    value |= (byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, offset: pos };
    shift += 7;
  }
  if (shift > 35) throw new Error('Java status VarInt is invalid.');
  return null;
}

function writeJavaString(text) {
  const body = Buffer.from(String(text), 'utf8');
  return Buffer.concat([writeVarInt(body.length), body]);
}

function frameJavaPacket(payload) {
  return Buffer.concat([writeVarInt(payload.length), payload]);
}

function encodeJavaHandshake(host, port, protocol = JAVA_STATUS_PROTOCOL) {
  const body = Buffer.concat([
    writeVarInt(0),
    writeVarInt(protocol),
    writeJavaString(host),
    Buffer.from([(port >> 8) & 0xff, port & 0xff]),
    writeVarInt(1)
  ]);
  return frameJavaPacket(body);
}

function encodeJavaStatusRequest() {
  return frameJavaPacket(writeVarInt(0));
}

function stripFormatting(text) {
  return String(text || '').replace(/§./g, '');
}

function flattenMotd(description) {
  if (description == null) return '';
  if (typeof description === 'string') return description;
  const parts = [];
  if (typeof description.text === 'string') parts.push(description.text);
  if (Array.isArray(description.extra)) {
    for (const extra of description.extra) parts.push(flattenMotd(extra));
  }
  return parts.join('');
}

function parseJavaStatusPacket(buffer) {
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  const length = readVarInt(input, 0);
  if (!length) throw new Error('Incomplete Java status packet.');
  const id = readVarInt(input, length.offset);
  if (!id) throw new Error('Incomplete Java status packet.');
  if (id.value !== 0) throw new Error('Unexpected Java status packet.');
  const strlen = readVarInt(input, id.offset);
  if (!strlen) throw new Error('Incomplete Java status packet.');
  const end = strlen.offset + strlen.value;
  if (input.length < end) throw new Error('Incomplete Java status packet.');
  let json;
  try {
    json = JSON.parse(input.subarray(strlen.offset, end).toString('utf8'));
  } catch {
    throw new Error('Java status JSON is invalid.');
  }
  const version = json?.version || {};
  const players = json?.players || {};
  return {
    motd: stripFormatting(flattenMotd(json?.description)).trim(),
    version: String(version.name || ''),
    protocol: Number(version.protocol || 0),
    online: Number(players.online || 0),
    max: Number(players.max || 0)
  };
}

function encodeUnconnectedPing(timestamp = 0n, guid = 0n) {
  const packet = Buffer.alloc(1 + 8 + 16 + 8);
  packet.writeUInt8(UNCONNECTED_PING, 0);
  packet.writeBigInt64BE(BigInt(timestamp), 1);
  RAKNET_MAGIC.copy(packet, 9);
  packet.writeBigInt64BE(BigInt(guid), 25);
  return packet;
}

function parseBedrockPong(buffer) {
  const input = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
  if (input.length < 35 || input[0] !== UNCONNECTED_PONG) throw new Error('Invalid Bedrock pong.');
  const magic = input.subarray(17, 33);
  if (!magic.equals(RAKNET_MAGIC)) throw new Error('Invalid Bedrock pong.');
  const length = input.readUInt16BE(33);
  const start = 35;
  if (input.length < start + length) throw new Error('Incomplete Bedrock pong.');
  const text = input.subarray(start, start + length).toString('utf8');
  const parts = text.split(';');
  if (!parts[0]) throw new Error('Invalid Bedrock pong.');
  return {
    edition: parts[0] || '',
    motd: parts[1] || '',
    protocol: parts[2] || '',
    version: parts[3] || '',
    online: Number(parts[4] || 0),
    max: Number(parts[5] || 0),
    serverId: parts[6] || '',
    motd2: parts[7] || '',
    gamemode: parts[8] || ''
  };
}

module.exports = {
  RAKNET_MAGIC,
  JAVA_STATUS_PROTOCOL,
  encodeRconPacket,
  decodeRconPackets,
  redactSecret,
  writeVarInt,
  readVarInt,
  encodeJavaHandshake,
  encodeJavaStatusRequest,
  parseJavaStatusPacket,
  flattenMotd,
  encodeUnconnectedPing,
  parseBedrockPong
};

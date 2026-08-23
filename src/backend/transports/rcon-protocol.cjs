'use strict';

function encodePacket(requestId, type, body = '') {
  const bodyBuffer = Buffer.from(String(body), 'utf8');
  const payloadLength = 10 + bodyBuffer.length;
  const packet = Buffer.allocUnsafe(payloadLength + 4);
  packet.writeInt32LE(payloadLength, 0);
  packet.writeInt32LE(requestId, 4);
  packet.writeInt32LE(type, 8);
  bodyBuffer.copy(packet, 12);
  packet.writeUInt8(0, 12 + bodyBuffer.length);
  packet.writeUInt8(0, 13 + bodyBuffer.length);
  return packet;
}

function decodePackets(buffer) {
  const packets = [];
  let offset = 0;
  while (buffer.length - offset >= 4) {
    const length = buffer.readInt32LE(offset);
    if (length < 10 || length > 16 * 1024 * 1024) throw new Error(`Invalid RCON packet length: ${length}`);
    const total = length + 4;
    if (buffer.length - offset < total) break;
    const requestId = buffer.readInt32LE(offset + 4);
    const type = buffer.readInt32LE(offset + 8);
    const bodyEnd = offset + total - 2;
    const body = buffer.subarray(offset + 12, bodyEnd).toString('utf8');
    packets.push({ requestId, type, body });
    offset += total;
  }
  return { packets, remaining: buffer.subarray(offset) };
}

module.exports = { encodePacket, decodePackets };

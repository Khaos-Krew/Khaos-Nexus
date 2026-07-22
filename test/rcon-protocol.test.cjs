'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { encodePacket, decodePackets } = require('../shared/rcon-protocol.cjs');

test('encodes and decodes an RCON packet', () => {
  const encoded = encodePacket(42, 2, 'ShowPlayers');
  const decoded = decodePackets(encoded);
  assert.deepEqual(decoded.packets, [{ requestId: 42, type: 2, body: 'ShowPlayers' }]);
  assert.equal(decoded.remaining.length, 0);
});

test('preserves an incomplete packet for the next data chunk', () => {
  const encoded = encodePacket(7, 3, 'password');
  const first = decodePackets(encoded.subarray(0, 8));
  assert.equal(first.packets.length, 0);
  const second = decodePackets(Buffer.concat([first.remaining, encoded.subarray(8)]));
  assert.equal(second.packets[0].body, 'password');
});

test('decodes multiple packets in one buffer', () => {
  const buffer = Buffer.concat([encodePacket(1, 0, 'a'), encodePacket(2, 0, 'b')]);
  const decoded = decodePackets(buffer);
  assert.equal(decoded.packets.length, 2);
  assert.equal(decoded.packets[1].body, 'b');
});

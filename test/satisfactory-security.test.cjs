'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  credentialForms,
  safeTransportMessage,
  parseLightweightResponse,
  validateCommandResult
} = require('../bot/satisfactory-api.cjs');

function packet(cookie = 77n) {
  const name = Buffer.from('Factory', 'utf8');
  const buffer = Buffer.alloc(26 + 2 + name.length + 1);
  buffer.writeUInt16LE(0xF6D5, 0);
  buffer.writeUInt8(1, 2);
  buffer.writeUInt8(1, 3);
  buffer.writeBigUInt64LE(cookie, 4);
  buffer.writeUInt8(3, 12);
  buffer.writeUInt32LE(123, 13);
  buffer.writeBigUInt64LE(0n, 17);
  buffer.writeUInt8(0, 25);
  buffer.writeUInt16LE(name.length, 26);
  name.copy(buffer, 28);
  buffer.writeUInt8(1, buffer.length - 1);
  return buffer;
}

test('Satisfactory lightweight query requires the exact terminator and payload length', () => {
  assert.equal(parseLightweightResponse(packet(), 77n).serverName, 'Factory');
  const missingTerminator = packet();
  missingTerminator[missingTerminator.length - 1] = 0;
  assert.throws(() => parseLightweightResponse(missingTerminator, 77n), /terminator byte/i);
  const trailing = Buffer.concat([packet(), Buffer.from([1])]);
  assert.throws(() => parseLightweightResponse(trailing, 77n), /server name is malformed/i);
});

test('Satisfactory RunCommand rejects HTTP-success command failures', () => {
  assert.deepEqual(validateCommandResult({ ReturnValue: true, CommandResult: 'ok' }), { ReturnValue: true, CommandResult: 'ok' });
  assert.throws(() => validateCommandResult({ ReturnValue: false, CommandResult: 'Unknown command' }), (error) => {
    assert.equal(error.code, 'ACTION_REJECTED');
    assert.match(error.message, /Unknown command/);
    return true;
  });
});

test('Satisfactory direct transport errors redact raw encoded and base64 token forms', () => {
  const token = 'sat token/with+symbols';
  const forms = credentialForms(token);
  assert.equal(forms.length, 3);
  const message = safeTransportMessage(new Error(`raw=${forms[0]} encoded=${forms[1]} base64=${forms[2]}`), token);
  for (const form of forms) assert.equal(message.includes(form), false);
  assert.match(message, /\[REDACTED\]/);
});

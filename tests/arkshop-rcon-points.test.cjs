'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  validatePlayerId,
  parsePlayerPointsReply,
  getPlayerPoints,
  addPlayerPoints,
  setPlayerPoints
} = require('../src/sentinel/arkshop-rcon-points.cjs');

test('ArkShop point commands reject RCON command injection characters', () => {
  assert.throws(() => validatePlayerId('abc\nSetPoints victim 999'), /unsupported characters/);
  assert.throws(() => validatePlayerId('abc def'), /unsupported characters/);
  assert.equal(validatePlayerId('0002aabbccddeeff0011223344556677'), '0002aabbccddeeff0011223344556677');
});

test('ArkShop point replies parse the official RCON response', () => {
  assert.equal(parsePlayerPointsReply('Player has 250 points\n'), 250);
  assert.throws(() => parsePlayerPointsReply("Couldn't get points amount"), /could not return/);
});

test('ArkShop read and mutation operations use official RCON commands and verify the result', async () => {
  const commands = [];
  const rcon = {
    async execute(command) {
      commands.push(command);
      if (command.startsWith('AddPoints ')) return 'Successfully added points\n';
      if (command.startsWith('SetPoints ')) return 'Successfully set points\n';
      return 'Player has 275 points\n';
    }
  };
  const id = '0002aabbccddeeff0011223344556677';
  assert.equal((await getPlayerPoints(rcon, id)).points, 275);
  assert.equal((await addPlayerPoints(rcon, id, 25)).points, 275);
  assert.equal((await setPlayerPoints(rcon, id, 275)).points, 275);
  assert.deepEqual(commands, [
    `GetPlayerPoints ${id}`,
    `AddPoints ${id} 25`,
    `GetPlayerPoints ${id}`,
    `SetPoints ${id} 275`,
    `GetPlayerPoints ${id}`
  ]);
});

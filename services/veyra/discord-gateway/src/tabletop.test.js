import test from "node:test";
import assert from "node:assert/strict";
import {
  generateAdventureHook,
  parseDiceNotation,
  parseParticipants,
  rollDice,
  rollInitiative,
} from "./tabletop.js";

test("parseDiceNotation normalizes common D&D notation", () => {
  assert.deepEqual(parseDiceNotation("d20"), {
    notation: "d20",
    count: 1,
    sides: 20,
    modifier: 0,
  });
  assert.deepEqual(parseDiceNotation(" 2d6 + 3 "), {
    notation: "2d6+3",
    count: 2,
    sides: 6,
    modifier: 3,
  });
  assert.equal(parseDiceNotation("4d8-2").modifier, -2);
});

test("parseDiceNotation rejects unsafe roll sizes", () => {
  assert.throws(() => parseDiceNotation("101d6"), /between 1 and 100/);
  assert.throws(() => parseDiceNotation("d1"), /between d2 and d1000/);
  assert.throws(() => parseDiceNotation("hello"), /dice notation/);
});

test("rollDice returns individual rolls, subtotal and modifier", () => {
  const values = [4, 6];
  const result = rollDice("2d6+3", () => values.shift());
  assert.deepEqual(result.rolls, [4, 6]);
  assert.equal(result.subtotal, 10);
  assert.equal(result.total, 13);
});

test("initiative parses, rolls and sorts participants", () => {
  assert.deepEqual(parseParticipants("Vorkesh, Goblin, Cultist"), ["Vorkesh", "Goblin", "Cultist"]);
  const values = [9, 18, 12];
  const result = rollInitiative("Vorkesh, Goblin, Cultist", 2, () => values.shift());
  assert.deepEqual(result.map((entry) => entry.name), ["Goblin", "Cultist", "Vorkesh"]);
  assert.deepEqual(result.map((entry) => entry.total), [20, 14, 11]);
});

test("initiative rejects too many participants and extreme modifiers", () => {
  assert.throws(() => parseParticipants(Array.from({ length: 21 }, (_, i) => `P${i}`).join(",")), /up to 20/);
  assert.throws(() => rollInitiative("A", 21), /between -20 and \+20/);
});

test("adventure hooks use only the requested curated tone", () => {
  const hook = generateAdventureHook("mystery", () => 0);
  assert.equal(hook.tone, "mystery");
  assert.match(hook.location, /noble estate/);
  assert.match(hook.threat, /vanished/);
  assert.match(hook.complication, /misleading/);
  assert.match(hook.stakes, /clock tower/);
  assert.throws(() => generateAdventureHook("unknown"), /Unknown hook tone/);
});

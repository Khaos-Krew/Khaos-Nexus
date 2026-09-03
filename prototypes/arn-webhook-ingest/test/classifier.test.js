import test from "node:test";
import assert from "node:assert/strict";
import { classifyAnomaly } from "../src/classifier.js";

test("enraged is class IV with tek reward", () => {
  const result = classifyAnomaly("Enraged Rex");
  assert.equal(result.tier, 4);
  assert.equal(result.threat, "HIGH");
  assert.match(result.reward, /1 Tekgram/);
});

test("rare prefixes are class III", () => {
  assert.equal(classifyAnomaly("Princess Equus").tier, 3);
  assert.equal(classifyAnomaly("Noir Megalodon").tier, 3);
  assert.equal(classifyAnomaly("Pygmy Xanthic Manta").tier, 3);
});

test("unknown shiny defaults to class I", () => {
  assert.equal(classifyAnomaly("Shiny Argentavis").tier, 1);
});

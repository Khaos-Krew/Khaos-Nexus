import test from "node:test";
import assert from "node:assert/strict";
import { classifyAnomaly } from "../src/classifier.js";

test("enraged is KAIJU level with tek reward", () => {
  const result = classifyAnomaly("Enraged Rex");
  assert.equal(result.tier, 5);
  assert.equal(result.threat, "KAIJU");
  assert.equal(result.danger, "KAIJU");
  assert.match(result.reward, /1 Tekgram/);
});

test("rare prefixes are severe", () => {
  assert.equal(classifyAnomaly("Princess Equus").tier, 3);
  assert.equal(classifyAnomaly("Noir Megalodon").danger, "SEVERE");
  assert.equal(classifyAnomaly("Pygmy Xanthic Manta").tier, 3);
});

test("unknown shiny defaults to watch", () => {
  const result = classifyAnomaly("Shiny Argentavis");
  assert.equal(result.tier, 1);
  assert.equal(result.danger, "WATCH");
});

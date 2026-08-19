import assert from "node:assert/strict";
import test from "node:test";

import { desiredRankPositions, normalizeRankName, rankIndexForName } from "./rank-sync.js";

test("normalizes Discord role and Shop product names", () => {
  assert.equal(normalizeRankName("  Khaos-Warden! "), "khaoswarden");
});

test("maps the four canonical Shop ranks in hierarchy order", () => {
  assert.equal(rankIndexForName("Cipher Runner"), 0);
  assert.equal(rankIndexForName("nexus-raider"), 1);
  assert.equal(rankIndexForName("KHAOS WARDEN"), 2);
  assert.equal(rankIndexForName("Blackout Legend"), 3);
  assert.equal(rankIndexForName("Origin Founder"), -1);
});

test("places shop roles directly below Origin Founder", () => {
  assert.deepEqual(desiredRankPositions(20), [16, 17, 18, 19]);
});

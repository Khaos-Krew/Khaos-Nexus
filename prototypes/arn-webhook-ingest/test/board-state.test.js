import test from "node:test";
import assert from "node:assert/strict";
import { ArnBoardState } from "../src/board-state.js";

const standard = { tier: 1, danger: "WATCH", threat: "WATCH", label: "WATCH ANOMALY", emoji: "🧬" };
const kaiju = { tier: 5, danger: "KAIJU", threat: "KAIJU", label: "KAIJU-LEVEL THREAT", emoji: "☢️", reward: "1 Tekgram on termination" };

test("detection becomes active bounty", () => {
  const board = new ArnBoardState();
  const result = board.process(
    { event: "detected", server: "Genesis 1", dino: "Azure Argentavis", location: "Lat 40 / Lon 50", player: "" },
    standard,
    { messageId: "spawn-1", timestamp: 1000 }
  );

  assert.equal(result.changed, true);
  assert.equal(board.snapshot().length, 1);
  assert.equal(board.snapshot()[0].status, "ACTIVE");
});

test("defeated anomaly remains briefly then expires", () => {
  const board = new ArnBoardState({ resolvedTtlMs: 180000 });
  board.process(
    { event: "detected", server: "Astraeos", dino: "Enraged Rex", location: "", player: "" },
    kaiju,
    { messageId: "spawn-2", timestamp: 1000 }
  );

  board.process(
    { event: "terminated", server: "Astraeos", dino: "Enraged Rex", location: "", player: "Kirito" },
    kaiju,
    { messageId: "kill-2", timestamp: 5000 }
  );

  const resolved = board.snapshot()[0];
  assert.equal(resolved.status, "DEFEATED");
  assert.equal(resolved.player, "Kirito");
  assert.equal(resolved.expiresAt, 185000);

  assert.equal(board.cleanup(184999), 0);
  assert.equal(board.cleanup(185000), 1);
  assert.equal(board.snapshot().length, 0);
});

test("same anomaly name on different maps resolves independently", () => {
  const board = new ArnBoardState();
  board.process(
    { event: "detected", server: "Genesis 1", dino: "Noir Megalodon", location: "", player: "" },
    standard,
    { messageId: "g1", timestamp: 1000 }
  );
  board.process(
    { event: "detected", server: "Astraeos", dino: "Noir Megalodon", location: "", player: "" },
    standard,
    { messageId: "ast", timestamp: 2000 }
  );

  board.process(
    { event: "contained", server: "Genesis 1", dino: "Noir Megalodon", location: "", player: "PlayerOne" },
    standard,
    { messageId: "g1-tame", timestamp: 3000 }
  );

  const entries = board.snapshot();
  assert.equal(entries.find((entry) => entry.server === "Genesis 1").status, "CAPTURED");
  assert.equal(entries.find((entry) => entry.server === "Astraeos").status, "ACTIVE");
});

test("duplicate Discord source message is ignored", () => {
  const board = new ArnBoardState();
  const parsed = { event: "detected", server: "Genesis 1", dino: "Xanthic Dodo", location: "", player: "" };

  board.process(parsed, standard, { messageId: "same", timestamp: 1000 });
  const duplicate = board.process(parsed, standard, { messageId: "same", timestamp: 1000 });

  assert.equal(duplicate.changed, false);
  assert.equal(board.snapshot().length, 1);
});

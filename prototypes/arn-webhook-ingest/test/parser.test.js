import test from "node:test";
import assert from "node:assert/strict";
import { parseShinyMessage } from "../src/parser.js";

function mockMessage({ title, description, footer = "", webhookId = "wh1" }) {
  return {
    content: "",
    webhookId,
    embeds: [{ title, description, footer: { text: footer } }],
  };
}

test("parses detection from Shiny embed", () => {
  const parsed = parseShinyMessage(
    mockMessage({
      title: "🧬 ANOMALY DETECTED",
      description: "**Princess Equus** detected on **Astraeos** at **Lat 42 / Lon 55**.",
      footer: "Anomaly Response Network • Khaos Nexus (Astraeos)",
    }),
    { wh1: "Astraeos" }
  );
  assert.equal(parsed.event, "detected");
  assert.equal(parsed.dino, "Princess Equus");
  assert.equal(parsed.server, "Astraeos");
});

test("parses terminated event", () => {
  const parsed = parseShinyMessage(
    mockMessage({
      title: "🧬 ANOMALY TERMINATED",
      description: "**Enraged Rex** was terminated by **Kirito**.",
    }),
    { wh1: "Genesis 1" }
  );
  assert.equal(parsed.event, "terminated");
  assert.equal(parsed.dino, "Enraged Rex");
  assert.equal(parsed.server, "Genesis 1");
  assert.equal(parsed.player, "Kirito");
});

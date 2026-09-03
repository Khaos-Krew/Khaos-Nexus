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

test("parses detection from dedicated Astraeos webhook", () => {
  const parsed = parseShinyMessage(
    mockMessage({
      title: "🧬 ANOMALY DETECTED",
      description: "**Princess Equus** detected on **Astraeos** at **Lat 42 / Lon 55**.",
      footer: "Anomaly Response Network • Khaos Nexus (Astraeos)",
      webhookId: "astra-wh",
    }),
    { "astra-wh": "Astraeos" }
  );
  assert.equal(parsed.event, "detected");
  assert.equal(parsed.dino, "Princess Equus");
  assert.equal(parsed.server, "Astraeos");
  assert.equal(parsed.sourceMapMismatch, false);
});

test("parses terminated event from dedicated Genesis 1 webhook", () => {
  const parsed = parseShinyMessage(
    mockMessage({
      title: "🧬 ANOMALY TERMINATED",
      description: "**Enraged Rex** was terminated by **Kirito**.",
      webhookId: "gen1-wh",
    }),
    { "gen1-wh": "Genesis 1" }
  );
  assert.equal(parsed.event, "terminated");
  assert.equal(parsed.dino, "Enraged Rex");
  assert.equal(parsed.server, "Genesis 1");
  assert.equal(parsed.player, "Kirito");
});

test("dedicated webhook mapping wins when payload is cross-wired", () => {
  const parsed = parseShinyMessage(
    mockMessage({
      title: "🧬 ANOMALY DETECTED",
      description: "**Noir Megalodon** detected on **Astraeos** at **unknown location**.",
      footer: "Anomaly Response Network • Khaos Nexus (Astraeos)",
      webhookId: "gen1-wh",
    }),
    { "gen1-wh": "Genesis 1" }
  );

  assert.equal(parsed.server, "Genesis 1");
  assert.equal(parsed.payloadServer, "Astraeos");
  assert.equal(parsed.sourceMapMismatch, true);
});

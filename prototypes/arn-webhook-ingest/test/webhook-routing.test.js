import test from "node:test";
import assert from "node:assert/strict";
import { mapFromArnWebhookName, normalizeMapName, sameMapName } from "../src/webhook-routing.js";

test("extracts map from ARN webhook naming convention", () => {
  assert.equal(mapFromArnWebhookName("ARN - Genesis 1"), "Genesis 1");
  assert.equal(mapFromArnWebhookName("arn- Astraeos"), "Astraeos");
});

test("rejects unrelated webhook names", () => {
  assert.equal(mapFromArnWebhookName("Shiny Alerts"), "");
  assert.equal(mapFromArnWebhookName("ARN"), "");
});

test("normalizes map names for validation", () => {
  assert.equal(normalizeMapName("Genesis-1"), "genesis 1");
  assert.equal(sameMapName("Genesis 1", "genesis-1"), true);
  assert.equal(sameMapName("Genesis 1", "Astraeos"), false);
});

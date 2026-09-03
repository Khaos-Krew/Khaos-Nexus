import test from "node:test";
import assert from "node:assert/strict";
import { classifyAnomaly } from "../src/classifier.js";

test("enraged is KAIJU level with tek reward", () => {
  const result = classifyAnomaly("Enraged Rex");
  assert.equal(result.tier, 5);
  assert.equal(result.trait, "Enraged");
  assert.equal(result.threat, "KAIJU");
  assert.equal(result.danger, "KAIJU");
  assert.match(result.reward, /1 Tekgram/);
});

test("critical combat abilities classify from the official ability list", () => {
  for (const name of [
    "Burning Equus",
    "Radioactive Dilophosaur",
    "Taser Lystrosaurus",
    "Crystalline Rex",
    "Colossal Stegosaur",
  ]) {
    const result = classifyAnomaly(name);
    assert.equal(result.tier, 4, name);
    assert.equal(result.danger, "CRITICAL", name);
    assert.equal(result.referenceMatched, true, name);
  }
});

test("severe defensive and status abilities classify correctly", () => {
  for (const name of [
    "Frozen Giganotosaurus",
    "Skeletal Rex",
    "Rubber Pteranodon",
    "Psychotropic Raptor",
    "Dazzling Stegosaurus",
    "Nightmare Shadowmane",
  ]) {
    const result = classifyAnomaly(name);
    assert.equal(result.tier, 3, name);
    assert.equal(result.danger, "SEVERE", name);
  }
});

test("pygmy is an ability but color-set names are not treated as rarity", () => {
  const pygmy = classifyAnomaly("Pygmy Xanthic Manta");
  assert.equal(pygmy.tier, 2);
  assert.equal(pygmy.trait, "Pygmy");
  assert.equal(pygmy.referenceMatched, true);

  const princess = classifyAnomaly("Princess Equus");
  assert.equal(princess.tier, 1);
  assert.equal(princess.trait, "Chromatic");
  assert.equal(princess.referenceMatched, false);

  const noir = classifyAnomaly("Noir Megalodon");
  assert.equal(noir.tier, 1);
  assert.equal(noir.trait, "Chromatic");
});

test("stat-focused and tiny traits are recognized", () => {
  const fierce = classifyAnomaly("Fierce Rex");
  assert.equal(fierce.tier, 2);
  assert.equal(fierce.trait.toLowerCase(), "fierce");

  const serene = classifyAnomaly("Serene Otter");
  assert.equal(serene.tier, 1);
  assert.equal(serene.trait.toLowerCase(), "serene");
});

test("unknown shiny defaults to chromatic watch", () => {
  const result = classifyAnomaly("Azure Argentavis");
  assert.equal(result.tier, 1);
  assert.equal(result.danger, "WATCH");
  assert.equal(result.trait, "Chromatic");
  assert.equal(result.referenceMatched, false);
});

import { randomInt } from "node:crypto";

const DICE_PATTERN = /^\s*(\d{0,3})d(\d{1,4})(?:\s*([+-])\s*(\d{1,5}))?\s*$/i;

export function parseDiceNotation(value) {
  const notation = String(value ?? "").trim();
  const match = DICE_PATTERN.exec(notation);
  if (!match) throw new Error("Use dice notation like d20, 2d6+3, or 4d8-2.");

  const count = match[1] ? Number(match[1]) : 1;
  const sides = Number(match[2]);
  const modifierMagnitude = match[4] ? Number(match[4]) : 0;
  const modifier = match[3] === "-" ? -modifierMagnitude : modifierMagnitude;

  if (!Number.isInteger(count) || count < 1 || count > 100) {
    throw new Error("Dice count must be between 1 and 100.");
  }
  if (!Number.isInteger(sides) || sides < 2 || sides > 1000) {
    throw new Error("Die size must be between d2 and d1000.");
  }
  if (modifier < -10_000 || modifier > 10_000) {
    throw new Error("Modifier must be between -10000 and +10000.");
  }

  return {
    notation: `${count === 1 ? "" : count}d${sides}${modifier > 0 ? `+${modifier}` : modifier < 0 ? modifier : ""}`,
    count,
    sides,
    modifier,
  };
}

export function rollDice(value, rng = randomInt) {
  const parsed = parseDiceNotation(value);
  const rolls = Array.from({ length: parsed.count }, () => rng(1, parsed.sides + 1));
  const subtotal = rolls.reduce((sum, roll) => sum + roll, 0);
  return { ...parsed, rolls, subtotal, total: subtotal + parsed.modifier };
}

export function parseParticipants(value) {
  const names = String(value ?? "")
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean);

  if (!names.length) throw new Error("Provide at least one participant, separated by commas.");
  if (names.length > 20) throw new Error("Initiative supports up to 20 participants at a time.");
  for (const name of names) {
    if (name.length > 60) throw new Error("Participant names must be 60 characters or fewer.");
  }
  return names;
}

export function rollInitiative(value, modifier = 0, rng = randomInt) {
  const names = parseParticipants(value);
  const numericModifier = Number(modifier ?? 0);
  if (!Number.isInteger(numericModifier) || numericModifier < -20 || numericModifier > 20) {
    throw new Error("Shared initiative modifier must be an integer between -20 and +20.");
  }

  return names
    .map((name, index) => {
      const roll = rng(1, 21);
      return { name, roll, modifier: numericModifier, total: roll + numericModifier, index };
    })
    .sort((a, b) => b.total - a.total || b.roll - a.roll || a.index - b.index);
}

const HOOKS = Object.freeze({
  classic: {
    locations: ["a rain-soaked border village", "an abandoned watchtower", "a crowded river market", "a ruined hilltop shrine"],
    threats: ["a missing caravan has returned without its drivers", "a sealed crypt has opened from the inside", "a local healer is being hunted by masked riders", "livestock vanish each night without tracks"],
    complications: ["the obvious suspect is protecting someone innocent", "the reward was promised by two rival patrons", "an old map contradicts every local account", "the threat is bound by a promise the party can exploit"],
    stakes: ["a trade road closes at dawn", "a prisoner will be executed by sunset", "a storm will isolate the region tonight", "a festival will place hundreds of people in danger"],
  },
  dark: {
    locations: ["a plague-silent mining town", "a battlefield where the dead do not decay", "a monastery buried in black snow", "a lantern-lit district under permanent curfew"],
    threats: ["people wake with memories that are not their own", "a respected magistrate is feeding names to something beneath the city", "the village bell rings whenever someone is about to die", "a returning warband claims the party already killed them"],
    complications: ["destroying the source would also kill its victims", "the monster is keeping something worse imprisoned", "the only truthful witness is legally condemned", "the curse began as an act of mercy"],
    stakes: ["another name appears on the death ledger each hour", "the town gates will be sealed permanently at midnight", "an innocent family will be sacrificed to contain the threat", "the dead will cross the river before sunrise"],
  },
  heroic: {
    locations: ["a mountain city preparing for siege", "a skybridge above a shattered valley", "a frontier keep surrounded by refugees", "a temple hosting a fragile peace summit"],
    threats: ["an invading champion has challenged the city's defenders", "a magical barrier is failing section by section", "a stolen banner could unite three enemy armies", "a young dragon is being forced to attack civilians"],
    complications: ["the enemy commander once saved the city", "victory requires trusting a disgraced former hero", "the artifact that can help belongs to a neutral faction", "the fastest solution would violate an important oath"],
    stakes: ["thousands will lose their only evacuation route", "the alliance collapses if the party fails publicly", "the defenders have supplies for one final day", "success could end a generation-long war"],
  },
  mystery: {
    locations: ["a noble estate locked from the inside", "a library where one room appears only at night", "a lakeside inn cut off by fog", "an archaeological camp built over an unknown city"],
    threats: ["a guest vanished from a room with no exits", "every witness remembers a different victim", "someone is replacing historical records overnight", "a murdered scholar left clues dated tomorrow"],
    complications: ["the strongest evidence is deliberately genuine but misleading", "one suspect cannot lie but can omit the truth", "the victim arranged part of the mystery before dying", "solving the crime exposes a much older conspiracy"],
    stakes: ["the killer will strike again when the clock tower chimes", "the evidence will be destroyed at dawn", "an innocent suspect is about to confess", "the discovery could trigger a succession crisis"],
  },
  wild: {
    locations: ["a tavern carried on the back of a colossal turtle", "a forest where gravity changes every hour", "a floating junkyard ruled by goblin salvagers", "a dungeon that insists it is a respectable hotel"],
    threats: ["a talking sword has hired adventurers to rescue its owner", "a wizard's failed teleport spell is swapping buildings between towns", "a dragon has opened a bank and is aggressively collecting debts", "a mimic colony is demanding legal recognition"],
    complications: ["the villain is technically correct about the contract", "the map is sentient and refuses to show dangerous routes", "the party has already been declared local celebrities", "every faction wants the same ridiculous object for a different serious reason"],
    stakes: ["reality resets at sunset", "the town will be repossessed tomorrow", "a planar customs inspector arrives in six hours", "the object at the center of the dispute is beginning to hatch"],
  },
});

function pick(items, rng) {
  return items[rng(0, items.length)];
}

export function generateAdventureHook(tone = "classic", rng = randomInt) {
  const key = String(tone ?? "classic").trim().toLowerCase() || "classic";
  const table = HOOKS[key];
  if (!table) throw new Error(`Unknown hook tone: ${key}`);
  return {
    tone: key,
    location: pick(table.locations, rng),
    threat: pick(table.threats, rng),
    complication: pick(table.complications, rng),
    stakes: pick(table.stakes, rng),
  };
}

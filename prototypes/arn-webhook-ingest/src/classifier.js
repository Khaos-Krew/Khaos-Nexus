const RULES = [
  { match: /\benraged\b/i, tier: 4, label: "HIGH-THREAT ANOMALY", threat: "HIGH", emoji: "⚠️", color: 0xe53935, reward: "1 Tekgram on termination" },
  { match: /\b(princess|noir|pygmy|spectral|lunar|solar|mythic)\b/i, tier: 3, label: "RARE ANOMALY", threat: "ELEVATED", emoji: "💠", color: 0x9c27b0 },
  { match: /\b(xanthic|azure|ember|jade|crimson|albino|melanistic)\b/i, tier: 2, label: "UNCOMMON ANOMALY", threat: "MODERATE", emoji: "🔬", color: 0xff9800 },
];

export function classifyAnomaly(name = "") {
  const hit = RULES.find((rule) => rule.match.test(name));
  if (hit) return { ...hit };
  return {
    tier: 1,
    label: "ANOMALY",
    threat: "STANDARD",
    emoji: "🧬",
    color: 0xc1121f,
  };
}

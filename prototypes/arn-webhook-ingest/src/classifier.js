const RULES = [
  {
    match: /\benraged\b/i,
    tier: 5,
    label: "KAIJU-LEVEL THREAT",
    threat: "KAIJU",
    danger: "KAIJU",
    emoji: "☢️",
    color: 0xe53935,
    reward: "1 Tekgram on termination",
  },
  {
    match: /\b(princess|noir|pygmy|spectral|lunar|solar|mythic)\b/i,
    tier: 3,
    label: "SEVERE ANOMALY",
    threat: "SEVERE",
    danger: "SEVERE",
    emoji: "💠",
    color: 0x9c27b0,
  },
  {
    match: /\b(xanthic|azure|ember|jade|crimson|albino|melanistic)\b/i,
    tier: 2,
    label: "ELEVATED ANOMALY",
    threat: "ELEVATED",
    danger: "ELEVATED",
    emoji: "🔬",
    color: 0xff9800,
  },
];

export function classifyAnomaly(name = "") {
  const hit = RULES.find((rule) => rule.match.test(name));
  if (hit) return { ...hit };

  return {
    tier: 1,
    label: "WATCH ANOMALY",
    threat: "WATCH",
    danger: "WATCH",
    emoji: "🧬",
    color: 0xc1121f,
  };
}

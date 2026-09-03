import { EmbedBuilder } from "discord.js";

const EVENT_STYLE = {
  detected: { label: "DETECTED", emoji: "🧬" },
  lost: { label: "SIGNAL LOST", emoji: "⚠️" },
  contained: { label: "CONTAINED", emoji: "✅" },
  terminated: { label: "TERMINATED", emoji: "☠️" },
  unknown: { label: "EVENT", emoji: "📡" },
};

export function buildArnEmbed(parsed, classification) {
  const eventStyle = EVENT_STYLE[parsed.event] || EVENT_STYLE.unknown;
  const title = parsed.event === "detected"
    ? `${classification.emoji} ARN // ${classification.label} DETECTED`
    : `${eventStyle.emoji} ARN // ANOMALY ${eventStyle.label}`;

  const lines = [
    `**${parsed.dino}**`,
    `\`CLASS ${classification.tier} • ${classification.threat}\``,
    "",
    `**Network:** ${parsed.server}`,
    `**Status:** ${eventStyle.label}`,
    `**Classification:** ${classification.label}`,
  ];

  if (parsed.location) lines.push(`**Location:** ${parsed.location}`);
  if (parsed.player) lines.push(`**Operator:** ${parsed.player}`);
  if (classification.reward && parsed.event === "detected") {
    lines.push(`**Termination Reward:** 🔓 ${classification.reward}`);
  }

  lines.push("", parsed.event === "detected" ? "📡 ARN tracking established." : "📡 ARN network state updated.");

  return new EmbedBuilder()
    .setColor(classification.color)
    .setTitle(title)
    .setDescription(lines.join("\n"))
    .setFooter({ text: `Anomaly Response Network • Khaos Nexus • ${parsed.server}` })
    .setTimestamp();
}

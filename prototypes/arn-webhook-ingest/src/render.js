import { EmbedBuilder } from "discord.js";

const STATUS_STYLE = {
  ACTIVE: { emoji: "🟢", label: "ACTIVE" },
  CAPTURED: { emoji: "✅", label: "CAPTURED" },
  DEFEATED: { emoji: "☠️", label: "DEFEATED" },
  "SIGNAL LOST": { emoji: "⚠️", label: "SIGNAL LOST" },
};

function discordTime(ms, style = "R") {
  return `<t:${Math.floor(ms / 1000)}:${style}>`;
}

function incidentLine(incident) {
  const status = STATUS_STYLE[incident.status] || { emoji: "📡", label: incident.status };
  const threat = incident.classification?.danger || incident.classification?.threat || "WATCH";
  const threatEmoji = incident.classification?.emoji || "🧬";

  const first = `${threatEmoji} **${incident.dino}** • \`${threat}\` • ${status.emoji} **${status.label}**`;
  const detail = [];

  if (incident.location) detail.push(incident.location);
  if (incident.player && incident.status === "CAPTURED") detail.push(`Captured by ${incident.player}`);
  if (incident.player && incident.status === "DEFEATED") detail.push(`Defeated by ${incident.player}`);
  if (incident.classification?.reward && incident.status === "ACTIVE") detail.push(`Reward: ${incident.classification.reward}`);
  if (incident.status === "ACTIVE") detail.push(`Detected ${discordTime(incident.detectedAt)}`);
  if (incident.expiresAt) detail.push(`Clears ${discordTime(incident.expiresAt)}`);

  return detail.length ? `${first}\n└ ${detail.join(" • ")}` : first;
}

function splitFieldLines(lines, maxLength = 1000) {
  const chunks = [];
  let current = "";

  for (const line of lines) {
    const candidate = current ? `${current}\n\n${line}` : line;
    if (candidate.length > maxLength && current) {
      chunks.push(current);
      current = line;
    } else {
      current = candidate;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export function buildBountyBoardEmbed(incidents = []) {
  const sorted = [...incidents].sort((a, b) => {
    const statusA = a.status === "ACTIVE" ? 0 : 1;
    const statusB = b.status === "ACTIVE" ? 0 : 1;
    if (statusA !== statusB) return statusA - statusB;

    const tierA = a.classification?.tier || 0;
    const tierB = b.classification?.tier || 0;
    if (tierA !== tierB) return tierB - tierA;

    return b.updatedAt - a.updatedAt;
  });

  const active = sorted.filter((incident) => incident.status === "ACTIVE");
  const kaiju = active.filter((incident) => (incident.classification?.danger || incident.classification?.threat) === "KAIJU");
  const resolved = sorted.filter((incident) => incident.status !== "ACTIVE");

  const embed = new EmbedBuilder()
    .setColor(kaiju.length ? 0xe53935 : 0xc1121f)
    .setTitle(kaiju.length ? "☢️ ARN // LIVE ANOMALY BOUNTY BOARD // KAIJU ALERT" : "🧬 ARN // LIVE ANOMALY BOUNTY BOARD")
    .setDescription([
      "**Anomaly Response Network • Khaos Nexus**",
      "Live Shiny detections consolidated across the ARK cluster.",
      "",
      `📡 **Active Signals:** ${active.length}   •   ☢️ **Kaiju Threats:** ${kaiju.length}   •   🗂️ **Recent Resolutions:** ${resolved.length}`,
    ].join("\n"));

  const byServer = new Map();
  for (const incident of sorted) {
    if (!byServer.has(incident.server)) byServer.set(incident.server, []);
    byServer.get(incident.server).push(incident);
  }

  if (!sorted.length) {
    embed.addFields({
      name: "📡 Network Clear",
      value: "No active anomaly signals are currently tracked.",
      inline: false,
    });
  } else {
    for (const [server, serverIncidents] of byServer) {
      const lines = serverIncidents.map(incidentLine);
      const chunks = splitFieldLines(lines);
      chunks.forEach((value, index) => {
        embed.addFields({
          name: index === 0 ? `🗺️ ${server}` : `🗺️ ${server} • Continued`,
          value,
          inline: false,
        });
      });
    }
  }

  embed
    .setFooter({ text: "ARN • Khaos Nexus • Live bounty board" })
    .setTimestamp();

  return embed;
}

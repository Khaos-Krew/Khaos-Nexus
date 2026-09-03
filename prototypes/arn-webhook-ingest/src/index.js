import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { parseShinyMessage } from "./parser.js";
import { classifyAnomaly } from "./classifier.js";
import { buildArnEmbed } from "./render.js";

const required = ["DISCORD_BOT_TOKEN", "ARN_INGEST_CHANNEL_ID", "ARN_OUTPUT_CHANNEL_ID"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
}

function loadServerByWebhook() {
  const map = {};

  // Scalable form for future cluster maps.
  // Example: {"123456789":"Genesis 1","987654321":"Astraeos"}
  if (process.env.ARN_SHINY_WEBHOOK_MAP_JSON) {
    let parsed;
    try {
      parsed = JSON.parse(process.env.ARN_SHINY_WEBHOOK_MAP_JSON);
    } catch (error) {
      throw new Error(`ARN_SHINY_WEBHOOK_MAP_JSON must be valid JSON: ${error.message}`);
    }

    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
      throw new Error("ARN_SHINY_WEBHOOK_MAP_JSON must be a JSON object of webhookId -> map name");
    }

    for (const [webhookId, serverName] of Object.entries(parsed)) {
      if (String(webhookId).trim() && String(serverName).trim()) {
        map[String(webhookId).trim()] = String(serverName).trim();
      }
    }
  }

  // Convenience variables for the two current Khaos Nexus maps.
  if (process.env.GEN1_SHINY_WEBHOOK_ID) map[process.env.GEN1_SHINY_WEBHOOK_ID.trim()] = "Genesis 1";
  if (process.env.ASTRAEOS_SHINY_WEBHOOK_ID) map[process.env.ASTRAEOS_SHINY_WEBHOOK_ID.trim()] = "Astraeos";

  return map;
}

const serverByWebhook = loadServerByWebhook();
const allowedWebhookIds = new Set(Object.keys(serverByWebhook));
if (!allowedWebhookIds.size) {
  throw new Error("ARN requires at least one dedicated Shiny webhook-to-map mapping");
}

const processed = new Set();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once("ready", () => {
  console.log(`[ARN] Prototype online as ${client.user.tag}`);
  console.log(`[ARN] Ingest channel: ${process.env.ARN_INGEST_CHANNEL_ID}`);
  console.log(`[ARN] Output channel: ${process.env.ARN_OUTPUT_CHANNEL_ID}`);
  console.log(`[ARN] Dedicated map webhooks: ${allowedWebhookIds.size}`);
  for (const [webhookId, serverName] of Object.entries(serverByWebhook)) {
    console.log(`[ARN] Source ${webhookId} -> ${serverName}`);
  }
});

client.on("messageCreate", async (message) => {
  try {
    if (message.channelId !== process.env.ARN_INGEST_CHANNEL_ID) return;
    if (!message.webhookId) return;
    if (!allowedWebhookIds.has(message.webhookId)) return;
    if (processed.has(message.id)) return;

    const parsed = parseShinyMessage(message, serverByWebhook);
    if (parsed.event === "unknown") {
      console.warn("[ARN] Ignoring unrecognized Shiny message", { messageId: message.id, title: parsed.sourceTitle });
      return;
    }

    if (parsed.sourceMapMismatch) {
      console.warn("[ARN] Payload map disagrees with dedicated webhook mapping; webhook mapping wins", {
        messageId: message.id,
        webhookId: message.webhookId,
        mappedServer: parsed.server,
        payloadServer: parsed.payloadServer,
      });
    }

    const classification = classifyAnomaly(parsed.dino);
    const output = await client.channels.fetch(process.env.ARN_OUTPUT_CHANNEL_ID);
    if (!output?.isTextBased()) throw new Error("ARN output channel is not text based");

    // One accepted Shiny source event produces at most one ARN output message.
    if (process.env.ARN_DRY_RUN === "true") {
      console.log("[ARN] DRY RUN", { sourceMessageId: message.id, parsed, classification });
    } else {
      await output.send({ embeds: [buildArnEmbed(parsed, classification)] });
    }

    processed.add(message.id);
    if (processed.size > 1000) processed.delete(processed.values().next().value);
  } catch (error) {
    console.error("[ARN] Failed to process Shiny webhook message", error);
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);

import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { parseShinyMessage } from "./parser.js";
import { classifyAnomaly } from "./classifier.js";
import { buildArnEmbed } from "./render.js";

const required = ["DISCORD_BOT_TOKEN", "ARN_INGEST_CHANNEL_ID", "ARN_OUTPUT_CHANNEL_ID"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
}

const serverByWebhook = {};
if (process.env.GEN1_SHINY_WEBHOOK_ID) serverByWebhook[process.env.GEN1_SHINY_WEBHOOK_ID] = "Genesis 1";
if (process.env.ASTRAEOS_SHINY_WEBHOOK_ID) serverByWebhook[process.env.ASTRAEOS_SHINY_WEBHOOK_ID] = "Astraeos";

const allowedWebhookIds = new Set(Object.keys(serverByWebhook));
const processed = new Set();

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.once("ready", () => {
  console.log(`[ARN] Prototype online as ${client.user.tag}`);
  console.log(`[ARN] Ingest channel: ${process.env.ARN_INGEST_CHANNEL_ID}`);
  console.log(`[ARN] Output channel: ${process.env.ARN_OUTPUT_CHANNEL_ID}`);
  console.log(`[ARN] Strict webhook filter: ${allowedWebhookIds.size > 0 ? "enabled" : "disabled"}`);
});

client.on("messageCreate", async (message) => {
  try {
    if (message.channelId !== process.env.ARN_INGEST_CHANNEL_ID) return;
    if (!message.webhookId) return;
    if (allowedWebhookIds.size && !allowedWebhookIds.has(message.webhookId)) return;
    if (processed.has(message.id)) return;

    const parsed = parseShinyMessage(message, serverByWebhook);
    if (parsed.event === "unknown") {
      console.warn("[ARN] Ignoring unrecognized Shiny message", { messageId: message.id, title: parsed.sourceTitle });
      return;
    }

    const classification = classifyAnomaly(parsed.dino);
    const output = await client.channels.fetch(process.env.ARN_OUTPUT_CHANNEL_ID);
    if (!output?.isTextBased()) throw new Error("ARN output channel is not text based");

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

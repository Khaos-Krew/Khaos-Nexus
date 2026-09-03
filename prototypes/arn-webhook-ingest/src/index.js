import "dotenv/config";
import { Client, GatewayIntentBits } from "discord.js";
import { parseShinyMessage } from "./parser.js";
import { classifyAnomaly } from "./classifier.js";
import { ArnBoardState } from "./board-state.js";
import { buildBountyBoardEmbed } from "./render.js";
import { mapFromArnWebhookName, sameMapName } from "./webhook-routing.js";

const required = ["DISCORD_BOT_TOKEN", "ARN_INGEST_CHANNEL_ID", "ARN_OUTPUT_CHANNEL_ID"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
}

function loadServerByWebhook() {
  const map = {};

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

  if (process.env.GEN1_SHINY_WEBHOOK_ID) map[process.env.GEN1_SHINY_WEBHOOK_ID.trim()] = "Genesis 1";
  if (process.env.ASTRAEOS_SHINY_WEBHOOK_ID) map[process.env.ASTRAEOS_SHINY_WEBHOOK_ID.trim()] = "Astraeos";

  return map;
}

function secondsEnv(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

const autoDiscoverWebhooks = process.env.ARN_AUTO_DISCOVER_WEBHOOKS === "true";
const serverByWebhook = loadServerByWebhook();
const allowedWebhookIds = new Set(Object.keys(serverByWebhook));
if (!allowedWebhookIds.size && !autoDiscoverWebhooks) {
  throw new Error("ARN requires at least one Shiny webhook-to-map mapping or ARN_AUTO_DISCOVER_WEBHOOKS=true");
}

const boardState = new ArnBoardState({
  resolvedTtlMs: secondsEnv("ARN_RESOLVED_TTL_SECONDS", 180) * 1000,
  lostTtlMs: secondsEnv("ARN_LOST_TTL_SECONDS", 60) * 1000,
});

const replayLimit = Math.min(100, Math.max(1, secondsEnv("ARN_REPLAY_LIMIT", 100)));
const cleanupIntervalMs = Math.max(5000, secondsEnv("ARN_CLEANUP_INTERVAL_SECONDS", 15) * 1000);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

let ingestChannel;
let outputChannel;
let boardMessage;
let renderQueue = Promise.resolve();
let webhookRefreshQueue = Promise.resolve();

async function refreshNamedWebhookMappings() {
  if (!autoDiscoverWebhooks) return 0;
  if (!ingestChannel?.fetchWebhooks) {
    throw new Error("ARN ingest channel cannot enumerate webhooks; verify it is a guild text channel");
  }

  let added = 0;
  const webhooks = await ingestChannel.fetchWebhooks();

  for (const webhook of webhooks.values()) {
    const namedMap = mapFromArnWebhookName(webhook.name || "");
    if (!namedMap) continue;

    const configuredMap = serverByWebhook[webhook.id];
    if (configuredMap) {
      allowedWebhookIds.add(webhook.id);
      if (!sameMapName(configuredMap, namedMap)) {
        console.warn("[ARN] Webhook name disagrees with pinned ID mapping; pinned mapping wins", {
          webhookId: webhook.id,
          webhookName: webhook.name,
          configuredMap,
          namedMap,
        });
      }
      continue;
    }

    serverByWebhook[webhook.id] = namedMap;
    allowedWebhookIds.add(webhook.id);
    added += 1;
    console.log(`[ARN] Discovered ${webhook.name} (${webhook.id}) -> ${namedMap}`);
  }

  return added;
}

function queueWebhookRefresh() {
  webhookRefreshQueue = webhookRefreshQueue
    .then(() => refreshNamedWebhookMappings())
    .catch((error) => {
      console.error("[ARN] Failed to discover named intake webhooks", error);
      return 0;
    });
  return webhookRefreshQueue;
}

function applySourceMessage(message, { replay = false } = {}) {
  if (message.channelId !== process.env.ARN_INGEST_CHANNEL_ID) {
    return { changed: false, ignored: true, reason: "wrong-channel" };
  }
  if (!message.webhookId) {
    return { changed: false, ignored: true, reason: "not-webhook" };
  }
  if (!allowedWebhookIds.has(message.webhookId)) {
    return { changed: false, ignored: true, reason: "unknown-webhook" };
  }

  const parsed = parseShinyMessage(message, serverByWebhook);
  if (parsed.event === "unknown") {
    if (!replay) {
      console.warn("[ARN] Ignoring unrecognized Shiny message", {
        messageId: message.id,
        title: parsed.sourceTitle,
      });
    }
    return { changed: false, ignored: true, reason: "unknown-event" };
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
  const result = boardState.process(parsed, classification, {
    messageId: message.id,
    timestamp: message.createdTimestamp || Date.now(),
  });

  if (result.ambiguousMatch) {
    console.warn("[ARN] Multiple active anomalies matched a lifecycle event; newest matching signal was updated", {
      messageId: message.id,
      server: parsed.server,
      dino: parsed.dino,
      candidates: result.candidateCount,
    });
  }

  return { ...result, parsed, classification };
}

async function locateBoardMessage() {
  if (boardMessage) return boardMessage;

  if (process.env.ARN_BOARD_MESSAGE_ID) {
    try {
      boardMessage = await outputChannel.messages.fetch(process.env.ARN_BOARD_MESSAGE_ID);
      return boardMessage;
    } catch (error) {
      console.warn("[ARN] Configured ARN_BOARD_MESSAGE_ID could not be fetched; falling back to discovery", error.message);
    }
  }

  const recent = await outputChannel.messages.fetch({ limit: 50 });
  boardMessage = recent.find((candidate) =>
    candidate.author?.id === client.user.id &&
    candidate.embeds?.[0]?.title?.includes("ARN // LIVE ANOMALY BOUNTY BOARD")
  );

  return boardMessage;
}

async function renderBoard() {
  const snapshot = boardState.snapshot();

  if (process.env.ARN_DRY_RUN === "true") {
    console.log("[ARN] DRY RUN BOARD", snapshot);
    return;
  }

  if (!outputChannel) {
    outputChannel = await client.channels.fetch(process.env.ARN_OUTPUT_CHANNEL_ID);
  }
  if (!outputChannel?.isTextBased() || !outputChannel.messages) {
    throw new Error("ARN output channel is not a message-capable text channel");
  }

  const embed = buildBountyBoardEmbed(snapshot);
  const existing = await locateBoardMessage();

  if (existing) {
    boardMessage = await existing.edit({ embeds: [embed], content: "" });
  } else {
    boardMessage = await outputChannel.send({ embeds: [embed] });
    console.log(`[ARN] Created bounty board message ${boardMessage.id}. Set ARN_BOARD_MESSAGE_ID=${boardMessage.id} to pin identity explicitly.`);
  }
}

function queueBoardRender() {
  renderQueue = renderQueue
    .then(() => renderBoard())
    .catch((error) => console.error("[ARN] Failed to render bounty board", error));
  return renderQueue;
}

async function rebuildFromIngestHistory() {
  if (!ingestChannel?.isTextBased() || !ingestChannel.messages) {
    throw new Error("ARN ingest channel is not a message-capable text channel");
  }

  const history = await ingestChannel.messages.fetch({ limit: replayLimit });
  const ordered = [...history.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);

  let accepted = 0;
  for (const message of ordered) {
    const result = applySourceMessage(message, { replay: true });
    if (result.changed) accepted += 1;
  }

  boardState.cleanup(Date.now());
  console.log(`[ARN] Replayed ${accepted} recognized Shiny lifecycle events from the hidden ingest channel.`);
}

client.once("ready", async () => {
  try {
    console.log(`[ARN] Prototype online as ${client.user.tag}`);
    console.log(`[ARN] Ingest channel: ${process.env.ARN_INGEST_CHANNEL_ID}`);
    console.log(`[ARN] Output channel: ${process.env.ARN_OUTPUT_CHANNEL_ID}`);

    ingestChannel = await client.channels.fetch(process.env.ARN_INGEST_CHANNEL_ID);
    outputChannel = await client.channels.fetch(process.env.ARN_OUTPUT_CHANNEL_ID);

    if (autoDiscoverWebhooks) {
      await queueWebhookRefresh();
    }
    if (!allowedWebhookIds.size) {
      throw new Error("No valid ARN map webhooks were found. Create webhooks named ARN - [mapname] or configure explicit webhook IDs.");
    }

    console.log(`[ARN] Dedicated map webhooks: ${allowedWebhookIds.size}`);
    for (const [webhookId, serverName] of Object.entries(serverByWebhook)) {
      console.log(`[ARN] Source ${webhookId} -> ${serverName}`);
    }

    await rebuildFromIngestHistory();
    await queueBoardRender();
  } catch (error) {
    console.error("[ARN] Failed during bounty board startup", error);
  }
});

client.on("messageCreate", async (message) => {
  try {
    let result = applySourceMessage(message);

    // If a new per-map webhook was added after Sentinel started, refresh the
    // channel's webhook metadata once and retry. The learned webhook ID then
    // becomes the authoritative map key for the rest of this process lifetime.
    if (result.reason === "unknown-webhook" && autoDiscoverWebhooks) {
      await queueWebhookRefresh();
      result = applySourceMessage(message);
    }

    if (!result.changed) return;

    console.log("[ARN] Bounty board event", {
      sourceMessageId: message.id,
      server: result.parsed.server,
      event: result.parsed.event,
      dino: result.parsed.dino,
      danger: result.classification.danger,
    });

    await queueBoardRender();
  } catch (error) {
    console.error("[ARN] Failed to process Shiny webhook message", error);
  }
});

const cleanupTimer = setInterval(() => {
  const removed = boardState.cleanup(Date.now());
  if (removed > 0) queueBoardRender();
}, cleanupIntervalMs);
cleanupTimer.unref?.();

client.login(process.env.DISCORD_BOT_TOKEN);

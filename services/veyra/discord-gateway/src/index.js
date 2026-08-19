import {
  ActivityType,
  Client,
  Events,
  GatewayIntentBits,
  MessageFlags,
  REST,
  Routes,
  SlashCommandBuilder,
} from "discord.js";

const token = String(process.env.VEYRA_DISCORD_TOKEN ?? "").trim();
const aiBaseUrl = String(process.env.VEYRA_AI_BASE_URL ?? "").trim().replace(/\/$/, "");
const activityText = String(process.env.VEYRA_ACTIVITY_TEXT ?? "Watching over the Nexus archives").trim();
const startedAt = Date.now();

const commands = [
  new SlashCommandBuilder()
    .setName("veyra-status")
    .setDescription("Check Veyra's Discord and AI readiness."),
  new SlashCommandBuilder()
    .setName("veyra-about")
    .setDescription("Show Veyra's current testing role and authority boundary."),
].map((command) => command.toJSON());

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

async function checkAiHealth() {
  if (!aiBaseUrl) return { configured: false, healthy: false, detail: "AI service URL not configured" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch(`${aiBaseUrl}/health`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return { configured: true, healthy: false, detail: `HTTP ${response.status}` };
    const payload = await response.json().catch(() => ({}));
    return {
      configured: true,
      healthy: payload?.status === "ok",
      detail: payload?.status === "ok" ? "healthy" : "unexpected health response",
    };
  } catch (error) {
    return {
      configured: true,
      healthy: false,
      detail: error?.name === "AbortError" ? "health check timed out" : String(error?.message || "unreachable"),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function registerCommands(applicationId) {
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationCommands(applicationId), { body: commands });
  console.log(`[commands] registered ${commands.length} global readiness commands for application=${applicationId}`);
}

client.once(Events.ClientReady, async (readyClient) => {
  const application = await readyClient.application.fetch();
  readyClient.user.setPresence({
    status: "online",
    activities: [{ name: activityText, type: ActivityType.Watching }],
  });

  console.log(
    `[ready] Veyra - Lore Master logged in as ${readyClient.user.tag} ` +
      `(botId=${readyClient.user.id} applicationId=${application.id} guilds=${readyClient.guilds.cache.size})`,
  );
  console.log("[authority] prep-only gateway: Guilds intent only; no message-content access; no campaign mutation handlers.");

  try {
    await registerCommands(application.id);
  } catch (error) {
    console.error("[commands] registration failed:", error);
  }

  setInterval(() => {
    const uptimeSec = Math.floor((Date.now() - startedAt) / 1000);
    console.log(`[heartbeat] ok ping=${client.ws.ping}ms guilds=${client.guilds.cache.size} uptimeSec=${uptimeSec}`);
  }, 60_000).unref();
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "veyra-about") {
    await interaction.reply({
      flags: MessageFlags.Ephemeral,
      content:
        "**Veyra — Lore Master**\n" +
        "D&D lore and Co-DM identity for Khaos Nexus. This Discord gateway is currently in prep/testing mode: " +
        "it can report readiness, but it does not read normal messages or mutate campaign data.",
    });
    return;
  }

  if (interaction.commandName === "veyra-status") {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const health = await checkAiHealth();
    const aiLine = !health.configured
      ? "AI service: not linked"
      : health.healthy
        ? "AI service: healthy"
        : `AI service: unavailable (${health.detail})`;

    await interaction.editReply(
      `**Veyra readiness**\nDiscord gateway: online\n${aiLine}\nMode: prep-only / no campaign mutation`,
    );
  }
});

client.on(Events.Error, (error) => console.error("[client] error:", error));
client.on(Events.Warn, (message) => console.warn("[client] warn:", message));
client.on(Events.ShardError, (error, shardId) => console.error(`[gateway] shardError id=${shardId}:`, error));
client.on(Events.ShardReconnecting, (shardId) => console.log(`[gateway] shardReconnecting id=${shardId}`));
client.on(Events.ShardResume, (shardId, replayedEvents) => {
  console.log(`[gateway] shardResume id=${shardId} replayed=${replayedEvents}`);
});

async function shutdown(signal) {
  console.log(`[shutdown] received ${signal}`);
  try { client.destroy(); } catch (error) { console.error("[shutdown] client destroy failed:", error); }
  process.exit(0);
}

process.once("SIGTERM", () => shutdown("SIGTERM"));
process.once("SIGINT", () => shutdown("SIGINT"));
process.on("unhandledRejection", (reason) => console.error("[process] unhandledRejection:", reason));
process.on("uncaughtException", (error) => console.error("[process] uncaughtException:", error));

if (!token) {
  console.warn("[boot] VEYRA_DISCORD_TOKEN is not configured yet; gateway is staged and waiting safely offline.");
  setInterval(() => {
    console.log("[heartbeat] waiting for VEYRA_DISCORD_TOKEN; Discord connection has not been attempted.");
  }, 300_000);
} else {
  console.log("[boot] starting Veyra Discord gateway in prep-only mode");
  client.login(token).catch((error) => {
    console.error("[boot] Discord login failed:", error);
    process.exit(1);
  });
}

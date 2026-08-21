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
import { generateAdventureHook, rollDice, rollInitiative } from "./tabletop.js";

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
    .setDescription("Show Veyra's role, utility commands, and authority boundary."),
  new SlashCommandBuilder()
    .setName("veyra-roll")
    .setDescription("Roll D&D dice with standard notation.")
    .addStringOption((option) => option
      .setName("dice")
      .setDescription("Examples: d20, 2d6+3, 4d8-2")
      .setRequired(true)
      .setMaxLength(24)),
  new SlashCommandBuilder()
    .setName("veyra-initiative")
    .setDescription("Roll and sort initiative for a comma-separated group.")
    .addStringOption((option) => option
      .setName("participants")
      .setDescription("Example: Vorkesh, Goblin 1, Goblin 2")
      .setRequired(true)
      .setMaxLength(1000))
    .addIntegerOption((option) => option
      .setName("modifier")
      .setDescription("Shared initiative modifier for this quick roll")
      .setMinValue(-20)
      .setMaxValue(20)),
  new SlashCommandBuilder()
    .setName("veyra-hook")
    .setDescription("Generate a quick DM adventure hook without changing campaign data.")
    .addStringOption((option) => option
      .setName("tone")
      .setDescription("Style of hook")
      .addChoices(
        { name: "Classic", value: "classic" },
        { name: "Dark", value: "dark" },
        { name: "Heroic", value: "heroic" },
        { name: "Mystery", value: "mystery" },
        { name: "Wild", value: "wild" },
      ))
    .addBooleanOption((option) => option
      .setName("public")
      .setDescription("Post the hook publicly instead of only showing it to you")),
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
  console.log(`[commands] registered ${commands.length} global Veyra commands for application=${applicationId}`);
}

function signedModifier(value) {
  if (!value) return "";
  return value > 0 ? `+${value}` : String(value);
}

function formatRoll(result) {
  const detail = result.rolls.length <= 20
    ? `[${result.rolls.join(", ")}]`
    : `[${result.rolls.slice(0, 20).join(", ")}, … ${result.rolls.length - 20} more]`;
  return `🎲 **${result.notation}** → ${detail}${signedModifier(result.modifier)} = **${result.total}**`;
}

function formatInitiative(entries) {
  const lines = entries.map((entry, index) => {
    const mod = signedModifier(entry.modifier);
    return `**${index + 1}. ${entry.name}** — ${entry.total}  _(d20 ${entry.roll}${mod ? ` ${mod}` : ""})_`;
  });
  return `⚔️ **Initiative Order**\n${lines.join("\n")}`;
}

function formatHook(hook) {
  const title = hook.tone.charAt(0).toUpperCase() + hook.tone.slice(1);
  return [
    `📜 **Veyra's ${title} Adventure Hook**`,
    `**Where:** ${hook.location}.`,
    `**Problem:** ${hook.threat}.`,
    `**Twist:** ${hook.complication}.`,
    `**Clock:** ${hook.stakes}.`,
    "_Generated locally; no campaign data was read or changed._",
  ].join("\n");
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
  console.log("[authority] utility-enabled gateway: Guilds intent only; no message-content access; no autonomous campaign mutation handlers.");

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

  try {
    if (interaction.commandName === "veyra-about") {
      await interaction.reply({
        flags: MessageFlags.Ephemeral,
        content:
          "**Veyra — Lore Master**\n" +
          "D&D lore and Co-DM identity for Khaos Nexus. Veyra can now roll dice, sort quick initiative, and create local adventure hooks. " +
          "She still does not read normal messages or autonomously mutate campaign data. AI Co-DM commands will use explicit service-to-service authentication before they are enabled.",
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
        `**Veyra readiness**\nDiscord gateway: online\n${aiLine}\nUtilities: roll · initiative · adventure hook\nMode: utility-enabled / no autonomous campaign mutation`,
      );
      return;
    }

    if (interaction.commandName === "veyra-roll") {
      const notation = interaction.options.getString("dice", true);
      await interaction.reply({ content: formatRoll(rollDice(notation)) });
      return;
    }

    if (interaction.commandName === "veyra-initiative") {
      const participants = interaction.options.getString("participants", true);
      const modifier = interaction.options.getInteger("modifier") ?? 0;
      await interaction.reply({ content: formatInitiative(rollInitiative(participants, modifier)) });
      return;
    }

    if (interaction.commandName === "veyra-hook") {
      const tone = interaction.options.getString("tone") ?? "classic";
      const publicPost = interaction.options.getBoolean("public") ?? false;
      await interaction.reply({
        ...(publicPost ? {} : { flags: MessageFlags.Ephemeral }),
        content: formatHook(generateAdventureHook(tone)),
      });
    }
  } catch (error) {
    const content = `Veyra couldn't complete that request: ${String(error?.message || "unknown error")}`;
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content }).catch(() => {});
    } else {
      await interaction.reply({ flags: MessageFlags.Ephemeral, content }).catch(() => {});
    }
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
  console.log("[boot] starting Veyra Discord gateway in utility-enabled mode");
  client.login(token).catch((error) => {
    console.error("[boot] Discord login failed:", error);
    process.exit(1);
  });
}

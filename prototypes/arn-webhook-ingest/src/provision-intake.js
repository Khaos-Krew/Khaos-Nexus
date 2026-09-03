import "dotenv/config";
import {
  ChannelType,
  Client,
  GatewayIntentBits,
  PermissionFlagsBits,
} from "discord.js";

const required = ["DISCORD_BOT_TOKEN", "DISCORD_GUILD_ID"];
for (const key of required) {
  if (!process.env[key]) throw new Error(`Missing required environment variable: ${key}`);
}

const requestedCategoryId = process.env.ARN_HIDDEN_CATEGORY_ID?.trim() || "";
const requestedCategoryName = process.env.ARN_HIDDEN_CATEGORY_NAME?.trim() || "";
const channelName = (process.env.ARN_INGEST_CHANNEL_NAME || "arn-ingest")
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9-_]+/g, "-")
  .replace(/^-+|-+$/g, "") || "arn-ingest";

if (!requestedCategoryId && !requestedCategoryName) {
  throw new Error("Set ARN_HIDDEN_CATEGORY_ID (preferred) or ARN_HIDDEN_CATEGORY_NAME before provisioning the intake channel.");
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once("ready", async () => {
  try {
    const guild = await client.guilds.fetch(process.env.DISCORD_GUILD_ID);
    await guild.channels.fetch();
    const me = await guild.members.fetchMe();

    let category = requestedCategoryId ? guild.channels.cache.get(requestedCategoryId) : null;
    if (!category && requestedCategoryName) {
      category = guild.channels.cache.find((candidate) =>
        candidate.type === ChannelType.GuildCategory &&
        candidate.name.toLowerCase() === requestedCategoryName.toLowerCase()
      );
    }

    if (!category || category.type !== ChannelType.GuildCategory) {
      throw new Error("Configured hidden category was not found. Verify ARN_HIDDEN_CATEGORY_ID or ARN_HIDDEN_CATEGORY_NAME.");
    }

    let channel = guild.channels.cache.find((candidate) =>
      candidate.type === ChannelType.GuildText &&
      candidate.parentId === category.id &&
      candidate.name === channelName
    );

    let created = false;
    if (!channel) {
      channel = await guild.channels.create({
        name: channelName,
        type: ChannelType.GuildText,
        parent: category.id,
        topic: "Private ARN intake bus for per-map Shiny! Dinos webhooks. Read by Nexus Sentinel.",
        reason: "Prepare hidden ARN Shiny webhook intake channel for Nexus Sentinel",
      });
      created = true;

      // Start from the hidden category's existing permission model so staff/admin
      // visibility stays consistent with the rest of that category.
      await channel.lockPermissions();
    }

    // Always keep the intake private from @everyone and give Sentinel only the
    // channel capabilities needed to read events and discover webhook metadata.
    await channel.permissionOverwrites.edit(guild.roles.everyone, {
      ViewChannel: false,
    });
    await channel.permissionOverwrites.edit(me, {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: true,
      EmbedLinks: true,
      ManageWebhooks: true,
    });

    console.log(`[ARN] ${created ? "Created" : "Reused"} #${channel.name} (${channel.id}) under ${category.name} (${category.id}).`);
    console.log(`[ARN] Set ARN_INGEST_CHANNEL_ID=${channel.id}`);
    console.log("[ARN] Create one incoming webhook per ARK map in this channel using: ARN - [mapname]");
    console.log("[ARN] Examples: ARN - Genesis 1 | ARN - Astraeos");
    console.log("[ARN] No webhook URLs or tokens are read, stored, or printed by this provisioner.");
  } catch (error) {
    console.error("[ARN] Intake provisioning failed", error);
    process.exitCode = 1;
  } finally {
    client.destroy();
  }
});

client.login(process.env.DISCORD_BOT_TOKEN);

import {
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  Guild,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Role,
} from "discord.js";

export const RANKS = [
  { key: "cipher", name: "Cipher Runner", channels: ["cipher-lounge", "cipher-rewards"] },
  { key: "raider", name: "Nexus Raider", channels: ["raider-lounge", "raider-rewards"] },
  { key: "warden", name: "Khaos Warden", channels: ["warden-lounge", "warden-rewards"] },
  { key: "blackout", name: "Blackout Legend", channels: ["blackout-lounge", "blackout-rewards"] },
] as const;

const SUPPORTER_HUB_NAME = "SUPPORTER HUB";
const ORIGIN_FOUNDER_NAME = "Origin Founder";

export const rankCommand = new SlashCommandBuilder()
  .setName("ranks")
  .setDescription("Configure and repair Discord Server Shop rank access")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((command) => command.setName("setup").setDescription("Find Premium Roles and create locked rank channels"))
  .addSubcommand((command) => command.setName("sync").setDescription("Repair rank channel permissions and role order"))
  .addSubcommand((command) => command.setName("status").setDescription("Check Premium Roles, channels, role order, and permissions"));

export function normalizeRankName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function rankIndexForName(value: string): number {
  const normalized = normalizeRankName(value);
  return RANKS.findIndex((rank) => normalizeRankName(rank.name) === normalized);
}

export function desiredRankPositions(originPosition: number): number[] {
  return RANKS.map((_rank, index) => originPosition - (RANKS.length - index));
}

function findRoles(guild: Guild): Array<Role | null> {
  return RANKS.map((rank) => guild.roles.cache.find(
    (role) => normalizeRankName(role.name) === normalizeRankName(rank.name),
  ) ?? null);
}

async function roleMappings(guild: Guild) {
  await guild.roles.fetch();
  const roles = findRoles(guild);
  const missingRoles = RANKS.filter((_rank, index) => !roles[index]).map((rank) => rank.name);
  return { roles, missingRoles };
}

async function arrangeRankRoles(guild: Guild, roles: Role[]): Promise<void> {
  const originFounder = guild.roles.cache.find(
    (role) => normalizeRankName(role.name) === normalizeRankName(ORIGIN_FOUNDER_NAME),
  );
  if (!originFounder) throw new Error(`The existing ${ORIGIN_FOUNDER_NAME} role was not found.`);
  const botMember = guild.members.me ?? await guild.members.fetchMe();
  if (botMember.roles.highest.position <= originFounder.position) {
    throw new Error(`Move the Nexus Sentinel bot role above ${ORIGIN_FOUNDER_NAME}, then run /ranks setup again.`);
  }
  if (originFounder.position <= RANKS.length) {
    throw new Error(`${ORIGIN_FOUNDER_NAME} is too low to place all four shop roles beneath it.`);
  }
  const positions = desiredRankPositions(originFounder.position);
  await guild.roles.setPositions(roles.map((role, index) => ({ role, position: positions[index] })));
}

async function ensureRankChannels(guild: Guild, roles: Role[]): Promise<void> {
  let category = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildCategory
      && normalizeRankName(channel.name) === normalizeRankName(SUPPORTER_HUB_NAME),
  );
  if (!category) {
    category = await guild.channels.create({
      name: SUPPORTER_HUB_NAME,
      type: ChannelType.GuildCategory,
      reason: "Nexus Sentinel Server Shop rank setup",
    });
  }

  for (let index = 0; index < RANKS.length; index += 1) {
    const rank = RANKS[index];
    const allowedRoles = roles.slice(index);
    for (const channelName of rank.channels) {
      let channel = guild.channels.cache.find(
        (item) => item.parentId === category?.id && item.name === channelName,
      );
      if (!channel) {
        channel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: category.id,
          permissionOverwrites: [
            { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
            ...allowedRoles.map((role) => ({
              id: role.id,
              allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory],
            })),
          ],
          reason: "Nexus Sentinel Server Shop rank setup",
        });
      } else if ("permissionOverwrites" in channel) {
        await channel.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false }, {
          reason: "Nexus Sentinel Server Shop access repair",
        });
        for (const role of roles) {
          const allowed = allowedRoles.some((item) => item.id === role.id);
          await channel.permissionOverwrites.edit(role, {
            ViewChannel: allowed,
            SendMessages: allowed,
            ReadMessageHistory: allowed,
          }, { reason: "Nexus Sentinel Server Shop access repair" });
        }
      }
    }
  }
}

export async function syncGuildRanks(_client: Client<true>, guild: Guild): Promise<string> {
  const map = await roleMappings(guild);
  if (map.missingRoles.length) throw new Error(`Missing Server Shop Premium Roles: ${map.missingRoles.join(", ")}.`);
  const roles = map.roles as Role[];
  await arrangeRankRoles(guild, roles);
  await ensureRankChannels(guild, roles);
  return "Repaired Server Shop role order and cumulative channel access.";
}

async function setupGuild(client: Client<true>, guild: Guild): Promise<string> {
  const result = await syncGuildRanks(client, guild);
  return `Server Shop setup complete. Eight locked channels are ready under SUPPORTER HUB. ${result}`;
}

async function statusGuild(guild: Guild): Promise<string> {
  const map = await roleMappings(guild);
  const botMember = guild.members.me ?? await guild.members.fetchMe();
  const supporterHub = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildCategory
      && normalizeRankName(channel.name) === normalizeRankName(SUPPORTER_HUB_NAME),
  );
  const missingChannels = supporterHub
    ? RANKS.flatMap((rank) => rank.channels).filter((name) => !guild.channels.cache.some(
      (channel) => channel.parentId === supporterHub.id && channel.name === name,
    ))
    : RANKS.flatMap((rank) => [...rank.channels]);
  const originFounder = guild.roles.cache.find(
    (role) => normalizeRankName(role.name) === normalizeRankName(ORIGIN_FOUNDER_NAME),
  );
  const expectedPositions = originFounder ? desiredRankPositions(originFounder.position) : [];
  const roleOrderReady = Boolean(originFounder) && map.roles.every(
    (role, index) => role?.position === expectedPositions[index],
  );
  return [
    "Shop type: Discord Server Shop Premium Roles",
    `Premium Roles: ${map.missingRoles.length ? `missing ${map.missingRoles.join(", ")}` : "ready"}`,
    `SUPPORTER HUB: ${supporterHub ? "ready" : "missing"}`,
    `Rank channels: ${missingChannels.length ? `missing ${missingChannels.join(", ")}` : "ready"}`,
    `Role order below Origin Founder: ${roleOrderReady ? "ready" : "needs setup"}`,
    `Bot permissions: Manage Roles=${botMember.permissions.has(PermissionFlagsBits.ManageRoles)}, Manage Channels=${botMember.permissions.has(PermissionFlagsBits.ManageChannels)}`,
  ].join("\n");
}

export async function registerRankCommand(client: Client<true>): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    const commands = await guild.commands.fetch();
    const existing = commands.find((command) => command.name === rankCommand.name);
    if (existing) await guild.commands.edit(existing, rankCommand.toJSON());
    else await guild.commands.create(rankCommand.toJSON());
  }
}

export async function handleRankCommand(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (interaction.commandName !== rankCommand.name) return false;
  console.log(`[ranks] received subcommand=${interaction.options.getSubcommand(false) ?? "unknown"} guild=${interaction.guildId ?? "dm"} user=${interaction.user.id}`);
  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = interaction.guild;
    if (!guild) {
      await interaction.editReply("Rank commands can only be used inside a Discord server.");
      return true;
    }
    const subcommand = interaction.options.getSubcommand();
    const result = subcommand === "setup"
      ? await setupGuild(interaction.client, guild)
      : subcommand === "sync"
        ? await syncGuildRanks(interaction.client, guild)
        : await statusGuild(guild);
    await interaction.editReply(result);
  } catch (error) {
    console.error("[ranks] command failed:", error);
    const message = `Rank operation failed: ${error instanceof Error ? error.message : "unknown error"}`;
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply(message);
      else await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
    } catch (replyError) {
      console.error("[ranks] failed to acknowledge interaction:", replyError);
    }
  }
  return true;
}

export async function startRankReconciliation(client: Client<true>): Promise<void> {
  const intervalSeconds = Number(process.env.SHOP_RANK_SYNC_SECONDS ?? 900);
  const reconcile = async (reason: string) => {
    for (const guild of client.guilds.cache.values()) {
      try {
        const result = await syncGuildRanks(client, guild);
        console.log(`[ranks] ${reason} guild=${guild.id} ${result}`);
      } catch (error) {
        console.warn(`[ranks] ${reason} skipped guild=${guild.id}:`, error);
      }
    }
  };
  await reconcile("startup");
  if (Number.isFinite(intervalSeconds) && intervalSeconds > 0) {
    setInterval(() => void reconcile("scheduled"), intervalSeconds * 1000);
  }
}

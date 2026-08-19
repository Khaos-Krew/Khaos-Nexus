import {
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  Entitlement,
  Guild,
  GuildMember,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Collection,
  type Role,
  type SKU,
} from "discord.js";

export const RANKS = [
  {
    key: "cipher",
    name: "Cipher Runner",
    channels: ["cipher-lounge", "cipher-rewards"],
  },
  {
    key: "raider",
    name: "Nexus Raider",
    channels: ["raider-lounge", "raider-rewards"],
  },
  {
    key: "warden",
    name: "Khaos Warden",
    channels: ["warden-lounge", "warden-rewards"],
  },
  {
    key: "blackout",
    name: "Blackout Legend",
    channels: ["blackout-lounge", "blackout-rewards"],
  },
] as const;

const SUPPORTER_HUB_NAME = "SUPPORTER HUB";
const ORIGIN_FOUNDER_NAME = "Origin Founder";

export const rankCommand = new SlashCommandBuilder()
  .setName("ranks")
  .setDescription("Configure and repair Discord Shop rank access")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((command) =>
    command
      .setName("setup")
      .setDescription("Discover Shop products and create locked rank channels"),
  )
  .addSubcommand((command) =>
    command
      .setName("sync")
      .setDescription("Reconcile every active Shop entitlement with rank roles"),
  )
  .addSubcommand((command) =>
    command
      .setName("status")
      .setDescription("Check Shop products, roles, channels, and bot permissions"),
  );

export function normalizeRankName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function rankIndexForName(value: string): number {
  const normalized = normalizeRankName(value);
  return RANKS.findIndex((rank) => normalizeRankName(rank.name) === normalized);
}

export function desiredRankPositions(originPosition: number): number[] {
  // RANKS is lowest to highest; Discord positions count upward from @everyone.
  return RANKS.map((_rank, index) => originPosition - (RANKS.length - index));
}

function findRoles(guild: Guild): Array<Role | null> {
  return RANKS.map((rank) =>
    guild.roles.cache.find(
      (role) => normalizeRankName(role.name) === normalizeRankName(rank.name),
    ) ?? null,
  );
}

async function fetchRankSkus(client: Client<true>): Promise<Array<SKU | null>> {
  const skus = await client.application.fetchSKUs();
  return RANKS.map((rank) =>
    skus.find((sku) => normalizeRankName(sku.name) === normalizeRankName(rank.name)) ?? null,
  );
}

function activeRankIndex(
  entitlements: Iterable<Entitlement>,
  skuRankIndexes: Map<string, number>,
): number {
  let result = -1;
  for (const entitlement of entitlements) {
    const rankIndex = skuRankIndexes.get(entitlement.skuId);
    if (rankIndex !== undefined && entitlement.isActive() && rankIndex > result) result = rankIndex;
  }
  return result;
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
      reason: "Nexus Sentinel Discord Shop rank setup",
    });
  }

  for (let index = 0; index < RANKS.length; index += 1) {
    const rank = RANKS[index];
    const role = roles[index];
    for (const channelName of rank.channels) {
      let channel = guild.channels.cache.find(
        (channel) => channel.parentId === category?.id && channel.name === channelName,
      );
      if (!channel) {
        channel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          parent: category.id,
          permissionOverwrites: [
            { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
            {
              id: role.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
              ],
            },
          ],
          reason: "Nexus Sentinel Discord Shop rank setup",
        });
      } else if ("permissionOverwrites" in channel) {
        await channel.permissionOverwrites.edit(guild.roles.everyone, {
          ViewChannel: false,
        }, { reason: "Nexus Sentinel rank access repair" });
        await channel.permissionOverwrites.edit(role, {
          ViewChannel: true,
          SendMessages: true,
          ReadMessageHistory: true,
        }, { reason: "Nexus Sentinel rank access repair" });
      }
    }
  }
}

async function arrangeRankRoles(guild: Guild, roles: Role[]): Promise<void> {
  const originFounder = guild.roles.cache.find(
    (role) => normalizeRankName(role.name) === normalizeRankName(ORIGIN_FOUNDER_NAME),
  );
  if (!originFounder) {
    throw new Error(`The existing ${ORIGIN_FOUNDER_NAME} role was not found.`);
  }
  const botMember = guild.members.me ?? await guild.members.fetchMe();
  if (botMember.roles.highest.position <= originFounder.position) {
    throw new Error(
      `Move the Nexus Sentinel bot role above ${ORIGIN_FOUNDER_NAME}, then run /ranks setup again.`,
    );
  }
  if (originFounder.position <= RANKS.length) {
    throw new Error(`${ORIGIN_FOUNDER_NAME} is too low in the role list to place all four shop roles beneath it.`);
  }
  const positions = desiredRankPositions(originFounder.position);
  await guild.roles.setPositions(
    roles.map((role, index) => ({ role, position: positions[index] })),
  );
}

async function fetchAllRankEntitlements(client: Client<true>): Promise<Collection<string, Entitlement>> {
  const all = client.application.entitlements.cache.clone();
  let after: string | undefined;
  for (;;) {
    const page = await client.application.entitlements.fetch({
      limit: 100,
      after,
      excludeDeleted: false,
      excludeEnded: false,
      cache: true,
    });
    for (const [id, entitlement] of page) all.set(id, entitlement);
    if (page.size < 100) break;
    after = page.lastKey();
    if (!after) break;
  }
  return all;
}

async function applyMemberRank(
  member: GuildMember,
  rankIndex: number,
  roles: Role[],
  reason: string,
): Promise<void> {
  const desired = new Set(roles.slice(0, rankIndex + 1).map((role) => role.id));
  const add = roles.filter((role) => desired.has(role.id) && !member.roles.cache.has(role.id));
  const remove = roles.filter((role) => !desired.has(role.id) && member.roles.cache.has(role.id));
  if (add.length) await member.roles.add(add, reason);
  if (remove.length) await member.roles.remove(remove, reason);
}

async function mappings(client: Client<true>, guild: Guild) {
  await guild.roles.fetch();
  const roles = findRoles(guild);
  const skus = await fetchRankSkus(client);
  const missingRoles = RANKS.filter((_rank, index) => !roles[index]).map((rank) => rank.name);
  const missingSkus = RANKS.filter((_rank, index) => !skus[index]).map((rank) => rank.name);
  return { roles, skus, missingRoles, missingSkus };
}

export async function syncGuildRanks(client: Client<true>, guild: Guild): Promise<string> {
  const map = await mappings(client, guild);
  if (map.missingRoles.length || map.missingSkus.length) {
    throw new Error(
      `Setup incomplete. Missing roles: ${map.missingRoles.join(", ") || "none"}. Missing Shop products: ${map.missingSkus.join(", ") || "none"}.`,
    );
  }
  const roles = map.roles as Role[];
  const skuRankIndexes = new Map(map.skus.map((sku, index) => [sku!.id, index]));
  // Include ended/deleted entitlements so a reconciliation after downtime can
  // still find former purchasers and remove expired shop-managed access.
  const entitlements = await fetchAllRankEntitlements(client);
  const byUser = new Map<string, Entitlement[]>();
  for (const entitlement of entitlements.values()) {
    if (!skuRankIndexes.has(entitlement.skuId) || !entitlement.userId) continue;
    const current = byUser.get(entitlement.userId) ?? [];
    current.push(entitlement);
    byUser.set(entitlement.userId, current);
  }

  const managedMemberIds = new Set<string>(byUser.keys());

  let updated = 0;
  let absent = 0;
  for (const userId of managedMemberIds) {
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) {
      absent += 1;
      continue;
    }
    const rankIndex = activeRankIndex(byUser.get(userId) ?? [], skuRankIndexes);
    await applyMemberRank(member, rankIndex, roles, "Nexus Sentinel Shop entitlement reconciliation");
    updated += 1;
  }
  return `Reconciled ${updated} member(s)${absent ? `; ${absent} purchaser(s) are not in this server` : ""}.`;
}

export async function syncEntitlementUser(client: Client<true>, entitlement: Entitlement): Promise<void> {
  if (!entitlement.userId) return;
  for (const guild of client.guilds.cache.values()) {
    const map = await mappings(client, guild).catch(() => null);
    if (!map || map.missingRoles.length || map.missingSkus.length) continue;
    const roles = map.roles as Role[];
    const skuRankIndexes = new Map(map.skus.map((sku, index) => [sku!.id, index]));
    if (!skuRankIndexes.has(entitlement.skuId)) continue;
    const member = await guild.members.fetch(entitlement.userId).catch(() => null);
    if (!member) continue;
    const active = await client.application.entitlements.fetch({
      user: entitlement.userId,
      skus: map.skus as SKU[],
      excludeDeleted: true,
      excludeEnded: true,
      cache: true,
    });
    await applyMemberRank(
      member,
      activeRankIndex(active.values(), skuRankIndexes),
      roles,
      "Nexus Sentinel Shop entitlement event",
    );
  }
}

async function setupGuild(client: Client<true>, guild: Guild): Promise<string> {
  const map = await mappings(client, guild);
  if (map.missingRoles.length || map.missingSkus.length) {
    return [
      "Setup could not finish.",
      `Missing existing roles: ${map.missingRoles.join(", ") || "none"}`,
      `Missing published Shop products: ${map.missingSkus.join(", ") || "none"}`,
      "Names must match Cipher Runner, Nexus Raider, Khaos Warden, and Blackout Legend (capitalization does not matter).",
    ].join("\n");
  }
  const roles = map.roles as Role[];
  const botMember = guild.members.me ?? await guild.members.fetchMe();
  const unmanageable = roles.filter((role) => role.position >= botMember.roles.highest.position);
  if (unmanageable.length) {
    return `Move the Nexus Sentinel bot role above these roles, then run setup again: ${unmanageable.map((role) => role.name).join(", ")}.`;
  }
  await arrangeRankRoles(guild, roles);
  await ensureRankChannels(guild, roles);
  const syncResult = await syncGuildRanks(client, guild);
  return `Rank Shop setup complete. Eight locked channels are ready under SUPPORTER HUB. ${syncResult}`;
}

async function statusGuild(client: Client<true>, guild: Guild): Promise<string> {
  const map = await mappings(client, guild);
  const botMember = guild.members.me ?? await guild.members.fetchMe();
  const supporterHub = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildCategory
      && normalizeRankName(channel.name) === normalizeRankName(SUPPORTER_HUB_NAME),
  );
  const missingChannels = supporterHub
    ? RANKS.flatMap((rank) => rank.channels).filter(
      (name) => !guild.channels.cache.some(
        (channel) => channel.parentId === supporterHub.id && channel.name === name,
      ),
    )
    : RANKS.flatMap((rank) => [...rank.channels]);
  const originFounder = guild.roles.cache.find(
    (role) => normalizeRankName(role.name) === normalizeRankName(ORIGIN_FOUNDER_NAME),
  );
  const expectedPositions = originFounder ? desiredRankPositions(originFounder.position) : [];
  const roleOrderReady = Boolean(originFounder) && (map.roles as Array<Role | null>).every(
    (role, index) => role?.position === expectedPositions[index],
  );
  return [
    `Roles: ${map.missingRoles.length ? `missing ${map.missingRoles.join(", ")}` : "ready"}`,
    `Shop products: ${map.missingSkus.length ? `missing ${map.missingSkus.join(", ")}` : "ready"}`,
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
  console.log(
    `[ranks] received subcommand=${interaction.options.getSubcommand(false) ?? "unknown"} guild=${interaction.guildId ?? "dm"} user=${interaction.user.id}`,
  );
  try {
    // Acknowledge before any cache fetch or API call. Discord invalidates an
    // interaction token if the first response takes more than three seconds.
    await interaction.deferReply({ ephemeral: true });
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
        : await statusGuild(interaction.client, guild);
    await interaction.editReply(result);
  } catch (error) {
    console.error("[ranks] command failed:", error);
    const message = `Rank operation failed: ${error instanceof Error ? error.message : "unknown error"}`;
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply(message);
      else await interaction.reply({ content: message, ephemeral: true });
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

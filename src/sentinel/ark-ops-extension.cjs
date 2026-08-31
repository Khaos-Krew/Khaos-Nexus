'use strict';

const { Client, Events, MessageFlags, SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const SftpClient = require('ssh2-sftp-client');
const { loadConfig } = require('../shared/config.cjs');
const { ArkRconClient, arkServerFromEnv } = require('./ark-rcon.cjs');
const { CACHE_POOLS } = require('./ark-dino-cache-engine.cjs');
const { runOwnerCacheTest } = require('./ark-dino-cache-test-harness.cjs');
const { ArkIdentityStore } = require('./ark-identity-store.cjs');
const { ArkAccountLinkService } = require('./ark-account-linking.cjs');
const { StateStore } = require('./state-store.cjs');
const { ArkPermissionRankSync, effectiveRankConfig } = require('./ark-permission-rank-sync.cjs');
const { parseListPlayers } = require('./ark-cluster-monitor.cjs');
const { parseArkChat, ArkCrossChatRouter } = require('./ark-cross-chat.cjs');
const { DEFAULT_SPECIES_POLICIES, parseSpeciesCount, evaluateSpeciesCount, correctionPlan, SpawnMonitorJournal } = require('./ark-spawn-monitor.cjs');
const { ArkSupporterCacheService } = require('./ark-supporter-cache-service.cjs');
const { EVENT_TYPES } = require('./ark-event-engine.cjs');
const { ArkEventService } = require('./ark-event-service.cjs');
const { parseArkPlayerActionId } = require('./module-console.cjs');
const {
  sftpSettingsFromEnv,
  remotePath,
  GAME_USER_SETTINGS_PATH,
  GAME_INI_PATH
} = require('./ark-sftp-config.cjs');

const INSTALLED = Symbol.for('khaos.nexus.ark.ops.extension');
const BOUND = Symbol.for('khaos.nexus.ark.ops.bound');

const CACHE_CHOICES = Object.freeze([
  { name: 'Coastal Cache — 800 NP', value: 'coastal' },
  { name: 'Forest Cache — 1,250 NP', value: 'forest' },
  { name: 'Swamp Cache — 1,400 NP', value: 'swamp' },
  { name: 'Mountain Cache — 1,800 NP', value: 'mountain' },
  { name: 'Ocean Cache — 2,200 NP', value: 'ocean' },
  { name: 'Deep Cave Cache — 2,200 NP', value: 'deepcave' },
  { name: 'Apex Cache — 8,000 NP • 7-day cooldown', value: 'apex' }
]);

const EVENT_CHOICES = Object.freeze(Object.values(EVENT_TYPES).map((event) => ({ name: `${event.label} — ${event.durationMinutes}m`, value: event.id })));

function arkCommand() {
  const command = new SlashCommandBuilder()
    .setName('ark')
    .setDescription('Manage the Khaos Nexus ARK server and ArkShop.');

  command.addSubcommand((sub) => sub.setName('status').setDescription('Test ARK RCON and show the current player response.'));
  command.addSubcommand((sub) => sub.setName('config-status').setDescription('Test ARK SFTP and verify the server config files are reachable.'));
  command.addSubcommand((sub) => sub.setName('players').setDescription('List connected ARK players.'));
  command.addSubcommand((sub) => sub.setName('link').setDescription('Create a one-time code to securely link your Discord and ARK accounts.'));
  command.addSubcommand((sub) => sub.setName('link-status').setDescription('Show your verified ARK account links and synced Nexus rank.'));
  command.addSubcommand((sub) => sub.setName('rank-sync').setDescription('Reconcile every linked Nexus rank into ARK Permissions now.'));
  command.addSubcommand((sub) => sub.setName('unlink').setDescription('Remove one of your verified ARK account links.')
    .addStringOption((option) => option.setName('eos_id').setDescription('Your linked ARK EOS player ID.').setRequired(true).setMaxLength(96)));
  for (const [name, description] of [
    ['supporter-cache', 'Claim an available non-P2W supporter reward cache.'],
    ['supporter-cache-status', 'Check your supporter cache allowance and event-token balance.']
  ]) {
    command.addSubcommand((sub) => sub.setName(name).setDescription(description)
      .addStringOption((option) => option.setName('type').setDescription('Daily or weekly supporter allowance.').setRequired(true)
        .addChoices({ name: 'Daily cache', value: 'daily' }, { name: 'Weekly cache', value: 'weekly' })));
  }
  command.addSubcommand((sub) => sub.setName('event-start').setDescription('Start a staff-controlled ARK event on this map.')
    .addStringOption((option) => option.setName('type').setDescription('Approved Nexus event type.').setRequired(true).addChoices(...EVENT_CHOICES))
    .addStringOption((option) => option.setName('objective').setDescription('Optional map-specific objective.').setMaxLength(300))
    .addIntegerOption((option) => option.setName('target').setDescription('Optional measurable target.').setMinValue(0).setMaxValue(1000000)));
  command.addSubcommand((sub) => sub.setName('event-status').setDescription('Show the active ARK event on this map.'));
  command.addSubcommand((sub) => sub.setName('event-progress').setDescription('Add verified progress to the active ARK event.')
    .addIntegerOption((option) => option.setName('amount').setDescription('Progress to add.').setRequired(true).setMinValue(0).setMaxValue(1000000))
    .addStringOption((option) => option.setName('note').setDescription('Optional staff audit note.').setMaxLength(240)));
  command.addSubcommand((sub) => sub.setName('event-finish').setDescription('Finish the active ARK event and prepare its reward hook.')
    .addStringOption((option) => option.setName('outcome').setDescription('Public-safe completion outcome.').setMaxLength(300)));
  command.addSubcommand((sub) => sub.setName('anomaly-propose').setDescription('Generate a safe, non-executable anomaly proposal for staff review.')
    .addIntegerOption((option) => option.setName('base_max_level').setDescription('Server normal wild max level.').setMinValue(1).setMaxValue(300)));
  command.addSubcommand((sub) => sub.setName('save').setDescription('Save the ARK world.'));
  command.addSubcommand((sub) => sub.setName('broadcast').setDescription('Broadcast a message in ARK.')
    .addStringOption((option) => option.setName('message').setDescription('Message to broadcast.').setRequired(true).setMaxLength(450)));
  command.addSubcommand((sub) => sub.setName('shop-cache').setDescription('Show how to buy a Nexus Dino Cache safely through ArkShop.')
    .addStringOption((option) => option.setName('cache').setDescription('Cache pool and price.').setRequired(true).addChoices(...CACHE_CHOICES)));
  command.addSubcommand((sub) => sub.setName('shop-cache-test').setDescription('Owner-only no-charge MAP1 Dino Cache delivery test.')
    .addStringOption((option) => option.setName('cache').setDescription('Cache pool to test.').setRequired(true).addChoices(...CACHE_CHOICES))
    .addStringOption((option) => option.setName('eos_id').setDescription('Configured MAP1 owner EOS ID.').setRequired(true).setMaxLength(96))
    .addBooleanOption((option) => option.setName('approved').setDescription('Confirm this no-charge test delivery.').setRequired(true)));
  command.addSubcommand((sub) => sub.setName('shop-reload').setDescription('Reload the ArkShop configuration.'));
  command.addSubcommand((sub) => sub.setName('shop-balance').setDescription('Get ArkShop points for an EOS ID.')
    .addStringOption((option) => option.setName('eos_id').setDescription('Player EOS ID.').setRequired(true).setMaxLength(80)));
  for (const [name, description] of [
    ['shop-add-points', 'Add ArkShop points to an EOS ID.'],
    ['shop-remove-points', 'Remove ArkShop points from an EOS ID.'],
    ['shop-set-points', 'Set the ArkShop point balance for an EOS ID.']
  ]) {
    command.addSubcommand((sub) => sub.setName(name).setDescription(description)
      .addStringOption((option) => option.setName('eos_id').setDescription('Player EOS ID.').setRequired(true).setMaxLength(80))
      .addIntegerOption((option) => option.setName('amount').setDescription('Point amount.').setRequired(true).setMinValue(0).setMaxValue(100000000)));
  }
  return command;
}

function isStaff(interaction, config) {
  const userId = String(interaction.user?.id || '');
  const owners = new Set((config.discord?.ownerUserIds || []).map(String));
  if (owners.has(userId)) return true;
  if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
  const operatorRoles = new Set((config.discord?.operatorRoleIds || []).map(String));
  return interaction.member?.roles?.cache?.some?.((role) => operatorRoles.has(String(role.id))) || false;
}

function isOwner(interaction, config) {
  const userId = String(interaction.user?.id || '');
  return (config.discord?.ownerUserIds || []).map(String).includes(userId) || userId === String(interaction.guild?.ownerId || '');
}

function safeEos(value) {
  const eos = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{8,96}$/.test(eos)) throw new Error('EOS ID format is invalid.');
  return eos;
}

function formatDuration(seconds) {
  const total = Math.max(0, Number(seconds) || 0);
  const days = Math.floor(total / 86400);
  const hours = Math.ceil((total % 86400) / 3600);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h`;
  return `${Math.ceil(total / 60)}m`;
}

function formatCacheResult(result) {
  if (!result?.ok) {
    if (result?.reason === 'insufficient-points') {
      return `❌ **Not enough Nexus Points**\nThis cache costs **${result.price} NP**. Current balance: **${result.balance} NP**.`;
    }
    if (result?.reason === 'cooldown') {
      return `⏳ **Apex Cache cooldown active**\nTry again in approximately **${formatDuration(result.remainingSeconds)}**.`;
    }
    return `❌ Dino Cache purchase was not completed${result?.reason ? `: ${result.reason}` : '.'}`;
  }
  const roll = result.roll || {};
  return [
    '✅ **Nexus Dino Cache delivered**',
    `Cache: **${String(roll.cacheId || '').toUpperCase()}** • **${roll.price} NP**`,
    `Roll: **${roll.species || 'Unknown'}** • Level **${roll.level || '?'}** • ${String(roll.rarity || 'unknown').toUpperCase()}`,
    'Delivery: **Dino Ball**',
    `Transaction: \`${String(result.transactionId || '').slice(0, 80)}\``
  ].join('\n');
}

function supporterRewardLabel(roll = {}) {
  const reward = roll.reward || {};
  if (reward.type === 'currency' && reward.currency === 'event-token') return `${Number(reward.amount) || 0} Nexus event token(s)`;
  if (reward.type === 'currency') return `${Number(reward.amount) || 0} Nexus Points`;
  if (reward.type === 'kit') return `Utility kit: ${String(reward.kit || reward.id || 'approved kit')}`;
  return String(reward.id || 'approved reward');
}

function formatSupporterClaim(result = {}) {
  if (!result.ok) {
    if (result.reason === 'allowance-used') return '⏳ **Supporter cache already claimed**\nYour current allowance has been used. Check again after the rolling period resets.';
    if (result.reason === 'no-entitlement') return 'ℹ️ **No cache allowance for this rank**\nSupporter caches are convenience and cosmetic incentives attached to eligible ranks.';
    if (result.reason === 'account-not-linked' || result.reason === 'ark-account-not-linked') return '🔗 **ARK account link required**\nUse `/ark link` and complete the one-time in-game verification first.';
    if (result.reason === 'multiple-ark-accounts') return '🔗 **Primary ARK account required**\nMore than one ARK identity is linked. Sentinel will not guess where to deliver a reward; unlink the unused identity until primary-account selection is available.';
    if (result.reason === 'manual-review') return `⚠️ **Claim needs staff review**\nA partial delivery may have occurred, so Sentinel blocked automatic retry. Claim: \`${String(result.claimId || '').slice(0, 80)}\``;
    return `⚠️ Supporter cache was not delivered: ${String(result.reason || 'delivery unavailable').slice(0, 160)}`;
  }
  const rewards = (result.rolls || []).map((roll) => `• **${supporterRewardLabel(roll)}**${roll.pity?.active ? ' • pity protection' : ''}`);
  return ['✅ **Nexus supporter cache delivered**', ...rewards, `Claim: \`${String(result.claim?.id || '').slice(0, 80)}\``, 'All rewards remain obtainable through normal play and within the configured value budget.'].join('\n');
}

function formatSupporterStatus(status = {}) {
  if (!status.ok) return formatSupporterClaim(status);
  return [
    '🎁 **Nexus supporter cache status**',
    `Rank: **${status.policy.rankId}**`,
    `Allowance: **${status.eligibility.remaining}/${status.policy.allowance} remaining** for the current ${status.policy.entitlementType} period`,
    `Nexus event tokens: **${status.eventTokens}**`,
    status.eligibility.ok ? 'A cache is ready to claim.' : 'This allowance has already been used.'
  ].join('\n');
}

function formatArkEventStatus(result = {}) {
  if (!result.ok) {
    if (result.reason === 'no-active-event') return 'ℹ️ No Sentinel-managed ARK event is active on this map.';
    if (result.reason === 'event-already-active') return `⚠️ **An ARK event is already active**\n${result.event?.label || result.event?.eventId || 'Current event'} must finish first.`;
    if (result.reason === 'cooldown') return `⏳ **Event cooldown active**\nTry this event again in approximately ${formatDuration(result.cooldown?.remainingSeconds || 0)}.`;
    if (result.reason === 'announcement-review') return `⚠️ **Event retained for announcement review**\nSentinel could not prove every broadcast completed, so it will not automatically repeat them. Runtime: \`${String(result.event?.id || '').slice(0, 80)}\``;
    return `⚠️ ARK event operation was not completed: ${String(result.reason || 'unavailable').slice(0, 160)}`;
  }
  if (result.active === false) return 'ℹ️ No Sentinel-managed ARK event is active on this map.';
  const event = result.event || {};
  const target = Number(event.target) > 0 ? `${Number(event.progress) || 0}/${event.target}` : `${Number(event.progress) || 0}`;
  return [
    `🎯 **${event.label || event.eventId || 'Nexus ARK Event'}**`,
    `State: **${String(event.state || 'active').toUpperCase()}**`,
    `Objective: ${event.objective || 'Staff-managed event objective'}`,
    `Progress: **${target}**`,
    event.endsAt ? `Ends: <t:${Math.floor(Date.parse(event.endsAt) / 1000)}:R>` : '',
    event.rewardHook?.state === 'ready-for-staff-award' ? 'Reward hook: **ready for staff award**' : ''
  ].filter(Boolean).join('\n');
}

function formatAnomalyProposal(result = {}) {
  const proposal = result.proposal || {};
  const anomaly = proposal.anomaly || {};
  return [
    '🧬 **Nexus anomaly proposal created**',
    `Tier: **${anomaly.tier || 'Unknown'}**`,
    `Species: **${anomaly.species || 'Unknown'}** • proposed level **${anomaly.targetLevel || '?'}**`,
    `Reward multiplier hook: **x${anomaly.rewardMultiplier || 1}**`,
    `Proposal: \`${String(proposal.id || '').slice(0, 80)}\``,
    '**No creature was spawned.** The proposal is audit-only and requires a separately verified spawn capability plus explicit approval.'
  ].join('\n');
}

async function registerArkCommand(guild) {
  const definition = arkCommand().toJSON();
  const commands = await guild.commands.fetch();
  const existing = commands.find((item) => item.name === definition.name);
  if (existing) await guild.commands.edit(existing, definition); else await guild.commands.create(definition);
}

async function arkConfigStatus(prefix = 'ARK_GEN1') {
  const settings = sftpSettingsFromEnv(prefix);
  const missing = [];
  if (!settings.host) missing.push(`${prefix}_SFTP_HOST`);
  if (!settings.username) missing.push(`${prefix}_SFTP_USERNAME`);
  if (!settings.password) missing.push(`${prefix}_SFTP_PASSWORD`);
  if (missing.length) throw new Error(`ARK SFTP variables are incomplete. Missing at runtime: ${missing.join(', ')}`);

  const gusPath = remotePath(settings.root, process.env[`${prefix}_GUS_PATH`] || GAME_USER_SETTINGS_PATH);
  const gamePath = remotePath(settings.root, process.env[`${prefix}_GAMEINI_PATH`] || GAME_INI_PATH);
  const shopPath = remotePath(settings.root, process.env[`${prefix}_ARKSHOP_CONFIG_PATH`] || 'ShooterGame/Binaries/Win64/ArkApi/Plugins/ArkShop/Configs/config.json');
  const client = new SftpClient('khaos-nexus-ark-status');

  try {
    await client.connect({
      host: settings.host,
      port: settings.port,
      username: settings.username,
      password: settings.password,
      readyTimeout: settings.readyTimeout
    });
    const cwd = await client.cwd().catch(() => 'unknown');
    const rootEntries = await client.list('.').then((items) => items.map((item) => item.name).slice(0, 20)).catch(() => []);
    const [gus, game, shop] = await Promise.all([
      client.exists(gusPath),
      client.exists(gamePath),
      client.exists(shopPath)
    ]);
    return {
      connected: true,
      gus: Boolean(gus),
      game: Boolean(game),
      shop: Boolean(shop),
      gusPath,
      gamePath,
      shopPath,
      cwd,
      rootEntries
    };
  } finally {
    await client.end().catch(() => {});
  }
}

async function handleArkInteraction(interaction, context) {
  const playerButton = interaction.isButton?.() ? parseArkPlayerActionId(interaction.customId) : null;
  const slashCommand = interaction.isChatInputCommand?.() && interaction.commandName === 'ark';
  if (!playerButton && !slashCommand) return false;
  const sub = playerButton?.subcommand || interaction.options.getSubcommand();
  const publicShopAction = ['shop-cache', 'shop-cache-guide', 'link', 'link-status', 'unlink', 'supporter-cache', 'supporter-cache-status'].includes(sub);
  if (!publicShopAction && !isStaff(interaction, context.config)) throw new Error('ARK server controls require Nexus staff authorization.');
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  if (sub === 'link') {
    if (String(process.env.ARK_GEN1_ACCOUNT_LINKING_ENABLED || 'false').toLowerCase() !== 'true') {
      throw new Error('Nexus ARK account linking is staged but not yet enabled for live verification.');
    }
    const challenge = context.identityStore.issueChallenge(String(interaction.user.id));
    const command = String(process.env.ARK_ACCOUNT_LINK_CHAT_COMMAND || '!link').trim() || '!link';
    await interaction.editReply({ content: [
      '🔐 **Nexus ARK account verification**',
      `In ARK chat, enter: \`${command} ${challenge.code}\``,
      `This one-time code expires <t:${Math.floor(Date.parse(challenge.expiresAt) / 1000)}:R>.`,
      'The code only succeeds from the currently connected ARK player, and Sentinel never stores the plain code.'
    ].join('\n'), allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'link-status') {
    const profile = context.identityStore.profileByDiscord(String(interaction.user.id));
    const accounts = profile?.arkAccounts || [];
    const body = accounts.length
      ? accounts.map((item) => `• **${item.playerName || 'ARK Survivor'}** — \`${item.eosId}\` • ${item.lastVerifiedMap || 'cluster'}`).join('\n')
      : 'No verified ARK accounts are linked yet. Use `/ark link` to begin.';
    await interaction.editReply({ content: `🔗 **Nexus identity**\nRank: **${profile?.rankId || 'shadow-recruit'}**\n${body}`.slice(0, 1900), allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'unlink') {
    const eosId = safeEos(interaction.options.getString('eos_id', true));
    if (context.rankSyncEnabled) {
      if (!context.rankSyncReady) throw new Error('ARK rank delivery is not ready, so Sentinel will not unlink an account while its server rank may remain assigned.');
      const revoked = await context.rankSync.revoke({ eosId, discordUserId: String(interaction.user.id), source: 'self-service-unlink' });
      if (!revoked.ok) throw new Error('Sentinel could not verify removal of the linked ARK rank. The account remains linked for safe recovery.');
    }
    const result = context.identityStore.unlinkArk({ discordUserId: String(interaction.user.id), eosId, actorId: String(interaction.user.id), reason: 'self-service Discord unlink' });
    if (!result.ok) throw new Error('That ARK account is not linked to your Discord account.');
    await interaction.editReply({ content: `✅ ARK identity \`${eosId}\` was unlinked. This action was recorded in the Nexus audit journal.`, allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'rank-sync') {
    if (!context.rankSyncEnabled) throw new Error('ARK permission-rank synchronization is not enabled.');
    if (!context.rankSyncReady) throw new Error('ARK permission-rank synchronization did not pass its Permissions plugin preflight.');
    const result = await context.syncAllLinkedRanks('staff-command');
    await interaction.editReply({ content: `✅ **Nexus ARK rank reconciliation**\nProfiles: **${result.profiles}** • accounts: **${result.accounts}** • changed: **${result.changed}** • failed: **${result.failed}**`, allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'supporter-cache' || sub === 'supporter-cache-status') {
    if (String(process.env.ARK_GEN1_SUPPORTER_CACHE_ENABLED || 'false').toLowerCase() !== 'true') {
      throw new Error('Nexus supporter caches are staged but not yet enabled for live delivery.');
    }
    const type = String(playerButton?.type || interaction.options.getString('type', true)).toLowerCase();
    const result = sub === 'supporter-cache'
      ? await context.supporterCaches.claim(String(interaction.user.id), type)
      : context.supporterCaches.status(String(interaction.user.id), type);
    const content = sub === 'supporter-cache' ? formatSupporterClaim(result) : formatSupporterStatus(result);
    await interaction.editReply({ content: content.slice(0, 1900), allowedMentions: { parse: [] } });
    return true;
  }

  if (['event-start', 'event-status', 'event-progress', 'event-finish', 'anomaly-propose'].includes(sub)) {
    if (String(process.env.ARK_GEN1_EVENT_ENGINE_ENABLED || 'false').toLowerCase() !== 'true') {
      throw new Error('The Sentinel ARK event engine is staged but not yet enabled for live broadcasts.');
    }
    let result;
    if (sub === 'event-start') result = await context.arkEvents.start({
      eventId: interaction.options.getString('type', true), objective: interaction.options.getString('objective') || '',
      target: interaction.options.getInteger('target') || 0, actorId: String(interaction.user.id)
    });
    else if (sub === 'event-status') result = context.arkEvents.status();
    else if (sub === 'event-progress') result = context.arkEvents.progress({ amount: interaction.options.getInteger('amount', true), note: interaction.options.getString('note') || '', actorId: String(interaction.user.id) });
    else if (sub === 'event-finish') result = await context.arkEvents.finish({ outcome: interaction.options.getString('outcome') || '', actorId: String(interaction.user.id) });
    else result = context.arkEvents.proposeAnomaly({ actorId: String(interaction.user.id), baseMaxLevel: interaction.options.getInteger('base_max_level') || 150 });
    const content = sub === 'anomaly-propose' ? formatAnomalyProposal(result) : formatArkEventStatus(result);
    await interaction.editReply({ content: content.slice(0, 1900), allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'shop-cache') {
    const cacheId = String(interaction.options.getString('cache', true)).toLowerCase();
    if (!CACHE_POOLS[cacheId]) throw new Error('Unknown Nexus Dino Cache.');
    await interaction.editReply({ content: [
      `🛒 **${cacheId.toUpperCase()} Dino Cache**`,
      `Price: **${CACHE_POOLS[cacheId].price} Nexus Points**`,
      'Purchase this cache inside the ARK shop. ArkShop performs the charge; Sentinel only processes its verified receipt and delivers the persisted roll.',
      'Discord purchases are disabled so there is one authoritative purchase ledger and no duplicate charge path.'
    ].join('\n').slice(0, 1900), allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'shop-cache-guide') {
    const caches = CACHE_CHOICES.map((cache) => `• **${cache.name.split(' — ')[0]}** — ${CACHE_POOLS[cache.value]?.price || 0} NP`);
    await interaction.editReply({ content: [
      '🦖 **Nexus Dino Cache Shop**',
      ...caches,
      '',
      'Purchase inside the ARK shop so ArkShop remains the authoritative charge ledger. Use `/ark shop-cache` for details about one cache.'
    ].join('\n').slice(0, 1900), allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'shop-cache-test') {
    if (!isOwner(interaction, context.config)) throw new Error('Dino Cache test delivery is restricted to the Nexus owner.');
    const result = await runOwnerCacheTest({
      cacheId: interaction.options.getString('cache', true), eosId: interaction.options.getString('eos_id', true),
      approved: interaction.options.getBoolean('approved', true), rcon: context.rcon
    });
    const roll = result.roll || {};
    await interaction.editReply({ content: [
      result.state === 'DELIVERED' ? '✅ **No-charge Dino Cache test delivered**' : '⚠️ **Dino Cache test needs manual review**',
      `State: **${result.state}** • Cache: **${String(result.cacheType || '').toUpperCase()}**`,
      `Roll: **${roll.species || 'Unknown'}** • level **${roll.level || '?'}** • ${String(roll.variant || 'normal').toUpperCase()}`,
      `Test transaction: \`${result.id}\``,
      '**Points charged: 0.** This owner-only harness does not represent a paid ArkShop purchase.',
      result.state === 'FAILED' ? 'Automatic retry is disabled; verify the owner inventory before any further test.' : ''
    ].filter(Boolean).join('\n').slice(0, 1900), allowedMentions: { parse: [] } });
    return true;
  }

  if (sub === 'config-status') {
    const status = await arkConfigStatus('ARK_GEN1');
    const request = String(process.env.ARK_GEN1_CONFIG_APPLY_ONCE || '').trim();
    const entries = status.rootEntries.length ? status.rootEntries.join(', ') : '(none visible)';
    const content = [
      `🗂️ **${context.server.name} Config Status**`,
      '',
      `SFTP: ${status.connected ? '🟢 Connected' : '🔴 Offline'}`,
      `GameUserSettings.ini: ${status.gus ? '✅ Found' : '❌ Missing'}`,
      `Game.ini: ${status.game ? '✅ Found' : '❌ Missing'}`,
      `ArkShop config.json: ${status.shop ? '✅ Found' : '⚠️ Not found'}`,
      `Baseline request: ${request ? `\`${request}\`` : 'Not requested'}`,
      '',
      `Configured root: \`${String(process.env.ARK_GEN1_SFTP_ROOT || '/').slice(0, 300)}\``,
      `SFTP cwd: \`${String(status.cwd).slice(0, 300)}\``,
      `Visible root entries: \`${entries.slice(0, 700)}\``
    ].join('\n');
    await interaction.editReply({ content: content.slice(0, 1900), allowedMentions: { parse: [] } });
    return true;
  }

  let command;
  if (sub === 'status' || sub === 'players') command = 'ListPlayers';
  else if (sub === 'save') command = 'SaveWorld';
  else if (sub === 'broadcast') command = `Broadcast ${interaction.options.getString('message', true)}`;
  else if (sub === 'shop-reload') command = 'ArkShop.Reload';
  else if (sub === 'shop-balance') command = `GetPlayerPoints ${safeEos(interaction.options.getString('eos_id', true))}`;
  else {
    const eos = safeEos(interaction.options.getString('eos_id', true));
    const amount = interaction.options.getInteger('amount', true);
    if (sub === 'shop-add-points') command = `AddPoints ${eos} ${amount}`;
    else if (sub === 'shop-remove-points') command = `ChangePoints ${eos} -${amount}`;
    else if (sub === 'shop-set-points') command = `SetPoints ${eos} ${amount}`;
  }
  if (!command) throw new Error('Unsupported ARK operation.');

  const result = await context.rcon.execute(command);
  const content = sub === 'status'
    ? `🟢 **${context.server.name}** RCON is responding.\n\n${result || 'No players are currently connected.'}`
    : `✅ **${context.server.name}**\n\n${result || 'Command accepted.'}`;
  await interaction.editReply({ content: content.slice(0, 1900), allowedMentions: { parse: [] } });
  return true;
}

function installArkOpsExtension() {
  if (Client.prototype[INSTALLED]) return;
  Client.prototype[INSTALLED] = true;
  const config = loadConfig();
  const server = arkServerFromEnv('ARK_GEN1');
  const originalLogin = Client.prototype.login;

  Client.prototype.login = function nexusArkOpsLogin(...args) {
    const client = this;
    if (!client[BOUND]) {
      client[BOUND] = true;
      client.on(Events.InteractionCreate, (interaction) => {
        const context = client.__nexusArkContext;
        if (!context || String(interaction.guildId || '') !== String(config.discord?.guildId || '')) return;
        void handleArkInteraction(interaction, context).catch(async (error) => {
          const payload = { content: `⚠️ ${String(error?.message || error).slice(0, 1700)}`, allowedMentions: { parse: [] } };
          if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
          else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral }).catch(() => {});
        });
      });
    }

    client.once(Events.ClientReady, () => {
      void (async () => {
        if (!server.enabled) {
          console.log('[Nexus Sentinal] ARK ops disabled by ARK_GEN1_ENABLED.');
          return;
        }
        if (!server.host || !server.port || !server.password) throw new Error('ARK_GEN1 RCON variables are incomplete.');
        const guild = await client.guilds.fetch(String(config.discord?.guildId || ''));
        const rcon = new ArkRconClient(server);
        const identityStore = new ArkIdentityStore();
        const accountLinking = new ArkAccountLinkService({ store: identityStore });
        const stateStore = new StateStore();
        const rankSyncEnabled = String(process.env.ARK_GEN1_RANK_SYNC_ENABLED || 'false').toLowerCase() === 'true';
        const rankSync = new ArkPermissionRankSync({
          rcon,
          provisionGroups: String(process.env.ARK_GEN1_RANK_GROUP_PROVISION_ENABLED || 'false').toLowerCase() === 'true'
        });
        const blockedTerms = String(process.env.NEXUS_ARK_CROSSCHAT_BLOCKED_TERMS || '').split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
        const crossChat = new ArkCrossChatRouter({ moderate: ({ message }) => ({
          allowed: !blockedTerms.some((term) => String(message || '').toLowerCase().includes(term)),
          reason: 'configured-moderation-term'
        }) });
        const supporterCaches = new ArkSupporterCacheService({ rcon, identityStore });
        const arkEvents = new ArkEventService({ rcon, mapId: server.id || 'gen1', mapName: server.name || 'ARK' });
        const syncMember = async (member, source = 'discord-role-sync') => {
          const effectiveConfig = effectiveRankConfig(config, stateStore.getAdminSettings());
          const synced = accountLinking.syncMemberRank(member, effectiveConfig);
          if (!synced.ok) return { ok: false, reason: synced.reason, accounts: 0, changed: 0, failed: 0 };
          if (synced.changed) console.log(`[Nexus Sentinal] linked profile rank synchronized: discord=${member.id} rank=${synced.profile.rankId}`);
          if (!rankSyncEnabled || !client.__nexusArkContext?.rankSyncReady) return { ok: true, rankId: synced.profile.rankId, accounts: 0, changed: 0, failed: 0 };
          const results = [];
          for (const account of synced.profile.arkAccounts || []) {
            results.push(await rankSync.reconcile({ eosId: account.eosId, rankId: synced.profile.rankId, discordUserId: member.id, source }).catch((error) => ({ ok: false, reason: String(error?.message || error) })));
          }
          return {
            ok: results.every((item) => item.ok), rankId: synced.profile.rankId, accounts: results.length,
            changed: results.filter((item) => item.changed).length, failed: results.filter((item) => !item.ok).length,
            results
          };
        };
        const syncAllLinkedRanks = async (source = 'periodic') => {
          const discordIds = Object.keys(identityStore.read().profiles);
          const summary = { profiles: discordIds.length, accounts: 0, changed: 0, failed: 0 };
          for (const discordId of discordIds) {
            const result = await guild.members.fetch(discordId).then((member) => syncMember(member, source)).catch(() => ({ ok: false, accounts: 0, changed: 0, failed: 1 }));
            summary.accounts += Number(result.accounts || 0);
            summary.changed += Number(result.changed || 0);
            summary.failed += Number(result.failed || 0) + (result.ok === false && !result.failed ? 1 : 0);
          }
          console.log(`[Nexus Sentinal] linked ARK rank reconciliation (${source}): profiles=${summary.profiles} accounts=${summary.accounts} changed=${summary.changed} failed=${summary.failed}`);
          return summary;
        };
        client.__nexusArkContext = { config, server, rcon, identityStore, accountLinking, crossChat, supporterCaches, arkEvents, rankSync, rankSyncEnabled, rankSyncReady: false, syncMember, syncAllLinkedRanks };
        await registerArkCommand(guild);
        const result = await rcon.execute('ListPlayers');
        console.log(`[Nexus Sentinal] ARK RCON ready: server=${server.name} host=${server.host}:${server.port} playersResponse=${String(result || 'none').slice(0, 120)}`);

        const linkingEnabled = String(process.env.ARK_GEN1_ACCOUNT_LINKING_ENABLED || 'false').toLowerCase() === 'true';
        const crossChatEnabled = String(process.env.NEXUS_ARK_CROSSCHAT_ENABLED || 'false').toLowerCase() === 'true';
        const crossChatChannelId = String(process.env.NEXUS_ARK_CROSSCHAT_CHANNEL_ID || '').trim();
        if (linkingEnabled) identityStore.requireSecret();
        if (rankSyncEnabled) {
          const preflight = await rankSync.ensureGroups();
          client.__nexusArkContext.rankSyncReady = preflight.ok;
          if (!preflight.ok) console.warn(`[Nexus Sentinal] ARK permission-rank sync blocked: reason=${preflight.reason} missing=${(preflight.missing || []).join(',') || 'unknown'}`);
          else console.log(`[Nexus Sentinal] ARK permission-rank sync ready: managedGroups=6 created=${preflight.created.length}`);
        }
        if (linkingEnabled || crossChatEnabled) {
          const chatCommand = String(process.env.ARK_GEN1_CHAT_POLL_COMMAND || 'GetChat').trim();
          const playerLinkCommand = String(process.env.ARK_ACCOUNT_LINK_CHAT_COMMAND || '!link').trim() || '!link';
          const pollMs = Math.max(5000, Number(process.env.ARK_GEN1_CHAT_POLL_SECONDS || 10) * 1000 || 10_000);
          let running = false;
          const poll = async () => {
            if (running) return;
            running = true;
            try {
              const [chat, playerResponse] = await Promise.all([rcon.execute(chatCommand), rcon.execute('ListPlayers')]);
              const players = parseListPlayers(playerResponse);
              if (linkingEnabled) {
                const linked = accountLinking.consumeChat(chat, { players, mapId: server.id || 'gen1', chatCommand: playerLinkCommand });
                for (const item of linked) {
                  console.log(`[Nexus Sentinal] ARK account link: ok=${item.ok} reason=${item.reason || 'verified'}`);
                  if (item.ok && item.profile?.discordUserId) {
                    void guild.members.fetch(item.profile.discordUserId)
                      .then((member) => syncMember(member, 'account-link'))
                      .catch((error) => console.warn(`[Nexus Sentinal] newly linked ARK rank sync failed: ${String(error?.message || error).slice(0, 240)}`));
                  }
                }
              }
              if (crossChatEnabled && crossChatChannelId) {
                const channel = await client.channels.fetch(crossChatChannelId).catch(() => null);
                for (const message of parseArkChat(chat)) {
                  const profile = message.eosId ? identityStore.profileByArk(message.eosId) : null;
                  let discordDisplayName = '';
                  if (profile?.discordUserId) discordDisplayName = await guild.members.fetch(profile.discordUserId).then((member) => member.displayName).catch(() => '');
                  const relay = crossChat.acceptArk(message, { mapId: server.name || server.id || 'ARK', identity: { discordDisplayName } });
                  if (relay.ok && channel?.send) await channel.send({ content: relay.content, allowedMentions: relay.allowedMentions });
                }
              }
            } catch (error) {
              console.warn(`[Nexus Sentinal] ARK account-link poll failed: ${String(error?.message || error).slice(0, 240)}`);
            } finally { running = false; }
          };
          const timer = setInterval(() => void poll(), pollMs);
          timer.unref?.();
          void poll();
          console.log(`[Nexus Sentinal] ARK chat poll enabled: map=${server.id || 'gen1'} linking=${linkingEnabled} crossChat=${crossChatEnabled} pollSeconds=${pollMs / 1000}`);
        } else {
          console.log('[Nexus Sentinal] ARK linking/cross-chat runtime is staged but disabled pending Extended RCON GetChat verification.');
        }

        if (crossChatEnabled && crossChatChannelId) {
          const sendCommand = String(process.env.ARK_GEN1_CHAT_SEND_COMMAND || 'ServerChat').trim();
          client.on(Events.MessageCreate, (message) => {
            if (String(message.channelId || '') !== crossChatChannelId || message.author?.bot || message.webhookId) return;
            const relay = crossChat.acceptDiscord({ authorId: message.author?.id, displayName: message.member?.displayName || message.author?.username, message: message.content }, { mapId: server.name || server.id || 'ARK' });
            if (relay.ok) void rcon.execute(`${sendCommand} ${relay.relay}`).catch((error) => console.warn(`[Nexus Sentinal] Discord-to-ARK relay failed: ${String(error?.message || error).slice(0, 240)}`));
          });
        }

        if (String(process.env.ARK_GEN1_SPAWN_MONITOR_ENABLED || 'false').toLowerCase() === 'true') {
          const commandTemplate = String(process.env.ARK_GEN1_SPECIES_COUNT_COMMAND || '').trim();
          if (!commandTemplate.includes('{class}')) {
            console.warn('[Nexus Sentinal] ARK spawn monitor disabled: ARK_GEN1_SPECIES_COUNT_COMMAND must include {class}.');
          } else {
            const base = DEFAULT_SPECIES_POLICIES.megalodon;
            const policy = {
              ...base,
              baselineTarget: Number(process.env.ARK_GEN1_MEGALODON_BASELINE || base.baselineTarget),
              alertCount: Number(process.env.ARK_GEN1_MEGALODON_ALERT_COUNT || base.alertCount),
              criticalCount: Number(process.env.ARK_GEN1_MEGALODON_CRITICAL_COUNT || base.criticalCount)
            };
            const journal = new SpawnMonitorJournal();
            const intervalMs = Math.max(60_000, Number(process.env.ARK_GEN1_SPAWN_MONITOR_SECONDS || 300) * 1000 || 300_000);
            let spawnRunning = false;
            const sample = async () => {
              if (spawnRunning) return;
              spawnRunning = true;
              try {
                const response = await rcon.execute(commandTemplate.replaceAll('{class}', policy.className));
                const count = parseSpeciesCount(response, policy);
                if (count == null) throw new Error('Species count response could not be parsed.');
                const baseline = journal.baseline(server.id || 'gen1', policy.id) || policy.baselineTarget;
                const result = evaluateSpeciesCount({ mapId: server.id || 'gen1', policy, count, baseline });
                journal.recordSample(result);
                if (result.state !== 'normal') {
                  const plan = correctionPlan(result, policy);
                  console.warn(`[Nexus Sentinal] ARK spawn alert: map=${result.mapId} species=${policy.id} count=${result.count} baseline=${result.baseline} ratio=${result.ratio} state=${result.state} autoCorrection=false recommendation=${plan.recommendation}`);
                  const alertChannelId = String(process.env.NEXUS_ARK_SPAWN_ALERT_CHANNEL_ID || '').trim();
                  if (alertChannelId) {
                    const channel = await client.channels.fetch(alertChannelId).catch(() => null);
                    await channel?.send?.({ content: `⚠️ **Nexus Spawn Alert • ${server.name || result.mapId}**\nMegalodon count: **${result.count}** • baseline: **${result.baseline}** • state: **${result.state.toUpperCase()}**\nNo correction was executed. Staff approval is required.\nGame.ini recommendation: \`${plan.recommendation}\``, allowedMentions: { parse: [] } });
                  }
                }
              } catch (error) {
                console.warn(`[Nexus Sentinal] ARK spawn monitor failed: ${String(error?.message || error).slice(0, 240)}`);
              } finally { spawnRunning = false; }
            };
            const spawnTimer = setInterval(() => void sample(), intervalMs);
            spawnTimer.unref?.();
            void sample();
            console.log(`[Nexus Sentinal] ARK Megalodon monitor enabled: intervalSeconds=${intervalMs / 1000} autoCorrection=false globalWipe=false`);
          }
        }

        if (String(process.env.ARK_GEN1_EVENT_ENGINE_ENABLED || 'false').toLowerCase() === 'true') {
          const eventTimer = setInterval(() => void arkEvents.tick().then((tick) => {
            if (tick.changed) console.log(`[Nexus Sentinal] ARK event window completed: map=${server.id || 'gen1'} event=${tick.event?.eventId || 'unknown'} announcementOk=${tick.ok !== false}`);
          }).catch((error) => console.warn(`[Nexus Sentinal] ARK event timer failed: ${String(error?.message || error).slice(0, 240)}`)), 60_000);
          eventTimer.unref?.();
        }

        client.on(Events.GuildMemberUpdate, (_before, after) => {
          if (String(after.guild?.id || '') === String(config.discord?.guildId || '')) void syncMember(after, 'guild-member-update');
        });
        void syncAllLinkedRanks('startup');
        const rankTimer = setInterval(() => void syncAllLinkedRanks('periodic'), 30 * 60_000);
        rankTimer.unref?.();
      })().catch((error) => console.warn(`[Nexus Sentinal] ARK ops unavailable: ${String(error?.message || error).slice(0, 240)}`));
    });

    return originalLogin.apply(this, args);
  };
}

module.exports = {
  CACHE_CHOICES,
  EVENT_CHOICES,
  arkCommand,
  isStaff,
  safeEos,
  formatDuration,
  formatCacheResult,
  supporterRewardLabel,
  formatSupporterClaim,
  formatSupporterStatus,
  formatArkEventStatus,
  formatAnomalyProposal,
  arkConfigStatus,
  handleArkInteraction,
  installArkOpsExtension
};

'use strict';

const { mcPointsFlags } = require('../shared/mc-points-flags.cjs');
const { beginMinecraftLink } = require('./mc-link-flow.cjs');
const { httpMinecraftPoints, economyConfigured } = require('./mc-economy-http.cjs');
const { runRcon } = require('./query.cjs');
const { installMcPlaytimeLoop } = require('./mc-playtime.cjs');
const { runMcDeliveryCycle } = require('./mc-delivery.cjs');

const DELIVERY_LOOP = Symbol.for('khaos.nexus.craft.mc.delivery');
const PLAYTIME_LOOP = Symbol.for('khaos.nexus.craft.mc.playtime');
const SWEEP_LOOP = Symbol.for('khaos.nexus.craft.mc.refund-sweep');

function reasonText(reason) {
  const messages = {
    'mc-points-disabled': 'Minecraft Points are off.',
    'mc-shop-disabled': 'The Minecraft shop is off. Open Sentinal when a staff member enables it.',
    'mc-starter-kit-disabled': 'The Minecraft Starter Kit is off.',
    'player-offline': 'That player is not on Nexus Craft right now.',
    'uuid-not-premium': 'That Minecraft account is not a premium Java UUID.',
    'mojang-mismatch': 'Mojang does not match that online player.',
    'mojang-unavailable': 'Mojang profile lookup failed. Try again shortly.',
    'whisper-failed': 'I could not whisper the code in game.',
    'rcon-failed': 'RCON did not answer. Nothing was changed.',
    'rcon-unparseable': 'The player list could not be read. Nothing was changed.',
    'invalid-player-name': 'Use the in-game name: 3 to 16 letters, numbers, or underscores.',
    'code-expired': 'That code expired. Run `/mc link start` again.',
    'code-mismatch': 'That code does not match. Check the whisper in game.',
    'code-locked': 'Too many wrong codes. Wait for the code to expire, then start again.',
    'link-rate-limited': 'That Minecraft account has had too many link requests this hour.',
    'unlink-cooldown': 'Unlink has a 30-day cooldown.',
    'not-linked': 'No verified Minecraft link was found.',
    'already-linked': 'Unlink the current Minecraft account first.',
    'uuid-taken': 'That Minecraft account is already linked.',
    'verified-identity-required': 'A verified Nexus identity is required before linking Minecraft.',
    'verified-minecraft-link-required': 'Link Minecraft with `/mc link start` first.',
    'account-too-new': 'The Discord account must be at least 30 days old.',
    'tenure-too-short': 'You need 7 days in this Discord first.',
    'playtime-too-short': 'Play on Nexus Craft for 15 counted minutes first.',
    'already-claimed': 'The Starter Kit was already claimed for this identity or Minecraft account.',
    'not-eligible': 'That account cannot claim the Starter Kit.',
    'economy-worker-unconfigured': 'The Nexus economy worker is not configured for Craft.',
    'staff-refund-sentinal-only': 'Staff refunds run in Sentinal, with a reason and a staff check.',
    'staff-resolve-sentinal-only': 'Staff order changes run in Sentinal.',
    'account-age-unknown': 'I could not read the Discord account age.',
    'tenure-unknown': 'I could not read how long you have been in this Discord.'
  };
  return messages[reason] || 'That Minecraft Points action could not be completed.';
}

async function defaultRcon(store) {
  const server = store.getServer('default');
  if (!server?.host || !server.port || !server.password) throw new Error('rcon-not-configured');
  return (command) => runRcon(server, command);
}

function pointsFor(env) {
  if (!economyConfigured(env)) return null;
  return httpMinecraftPoints(env);
}

async function handleMcPointsCommand(interaction, context) {
  const sub = interaction.options?.getSubcommand?.(false) || '';
  const group = interaction.options?.getSubcommandGroup?.(false) || '';
  const handled = group === 'link' || group === 'mcadmin' || sub === 'unlink' || sub === 'shop' || sub === 'starter';
  if (!handled) return false;
  const env = context.env || process.env;
  const points = context.points || pointsFor(env);
  const discordUserId = String(interaction.user?.id || '');
  if (group === 'mcadmin') {
    if (!context.isStaff) {
      await interaction.reply(context.ephemeral('Only Nexus staff can use that command.'));
      return true;
    }
    if (!points) {
      await interaction.reply(context.ephemeral(reasonText('economy-worker-unconfigured')));
      return true;
    }
    if (sub === 'orders') {
      const orders = await points.pendingOrders();
      const user = interaction.options.getString('user') || '';
      const lines = orders.filter((order) => !user || order.discordUserId === user).slice(0, 15)
        .map((order) => `${order.orderId} ${order.status} ${order.sku} <@${order.discordUserId}>`);
      await interaction.reply(context.ephemeral(lines.length ? lines.join('\n') : 'No queued Minecraft orders.'));
      return true;
    }
    if (sub === 'kits') {
      const grants = await points.listGrants();
      const lines = grants.slice(0, 15).map((grant) => `${grant.orderId} ${grant.status} \`${grant.mcUuid}\``);
      await interaction.reply(context.ephemeral(lines.length ? lines.join('\n') : 'No Starter Kit claims.'));
      return true;
    }
    if (sub === 'link-revoke') {
      const result = await points.unlink({
        discordUserId: interaction.options.getString('user'),
        actor: discordUserId,
        reason: 'staff-revoke'
      });
      await interaction.reply(context.ephemeral(result.ok ? `Link revoked. Cooldown until ${result.cooldownUntil}.` : reasonText(result.reason)));
      return true;
    }
    if (sub === 'resolve') {
      const orderId = interaction.options.getString('order');
      const action = interaction.options.getString('action');
      const result = action === 'refund'
        ? { ok: false, reason: 'staff-refund-sentinal-only' }
        : { ok: false, reason: 'staff-resolve-sentinal-only' };
      await interaction.reply(context.ephemeral(result.ok ? `${orderId} is now ${result.order?.status || action}.` : reasonText(result.reason)));
      return true;
    }
  }
  if (!points && sub !== 'shop') {
    await interaction.reply(context.ephemeral(reasonText('economy-worker-unconfigured')));
    return true;
  }
  if (group === 'link' && sub === 'start') {
    let rcon;
    try { rcon = context.rcon || await defaultRcon(context.store); }
    catch { await interaction.reply(context.ephemeral('RCON for `default` is not configured. Staff use `/mcrcon setup`.')); return true; }
    await interaction.deferReply({ flags: context.ephemeralFlags });
    const result = await beginMinecraftLink({
      username: interaction.options.getString('username'),
      discordUserId,
      requesterName: interaction.user?.username || discordUserId,
      rcon,
      points,
      fetchImpl: context.fetchImpl,
      env
    });
    await interaction.editReply({
      content: result.ok
        ? `Whispered a link code to **${result.mcName}**. It expires in 10 minutes. Confirm with \`/mc link confirm\`.`
        : reasonText(result.reason),
      allowedMentions: { parse: [] }
    });
    return true;
  }
  if (group === 'link' && sub === 'confirm') {
    const result = await points.confirm({ discordUserId, code: interaction.options.getString('code') });
    await interaction.reply(context.ephemeral(result.ok ? `Minecraft linked (\`${result.mcUuid}\`).` : reasonText(result.reason)));
    return true;
  }
  if (group === 'link' && sub === 'status') {
    const result = await points.status({ discordUserId });
    const text = result.linked
      ? `Linked Minecraft \`${result.mcUuid}\`.`
      : result.cooldownUntil
        ? `Not linked. Unlink cooldown until ${result.cooldownUntil}.`
        : 'No verified Minecraft link.';
    await interaction.reply(context.ephemeral(text));
    return true;
  }
  if (sub === 'unlink') {
    const result = await points.unlink({ discordUserId });
    await interaction.reply(context.ephemeral(result.ok ? `Unlinked. You can link again after ${result.cooldownUntil}.` : reasonText(result.reason)));
    return true;
  }
  if (sub === 'shop') {
    const flags = mcPointsFlags(env);
    await interaction.reply(context.ephemeral(flags.shopEnabled
      ? 'Open the Minecraft section of the shop in Sentinal. Nexus Craft does not sell items.'
      : 'The Minecraft shop is off. It will appear in Sentinal after it is enabled.'));
    return true;
  }
  if (sub === 'starter') {
    await interaction.reply(context.ephemeral(mcPointsFlags(env).starterKitEnabled
      ? 'Claim the Starter Kit from the Minecraft section in Sentinal. Nexus Craft does not grant it.'
      : 'The Minecraft Starter Kit is off.'));
    return true;
  }
  return false;
}

function installMcEconomyLoops({ store, env = process.env, log = console.log } = {}) {
  if (!economyConfigured(env)) return { started: false, timers: [] };
  const points = httpMinecraftPoints(env);
  const flags = mcPointsFlags(env);
  const timers = [];
  if (flags.trackingEnabled && !globalThis[PLAYTIME_LOOP]) {
    globalThis[PLAYTIME_LOOP] = true;
    const playtime = installMcPlaytimeLoop({
      env,
      presence: (input) => points.presence(input),
      rcon: async (command) => {
        const rcon = await defaultRcon(store);
        return rcon(command);
      },
      log: (summary) => log(`[Nexus Craft] mc playtime online=${summary.online} players=${summary.players} afk=${summary.afk} failures=${summary.failures}`)
    });
    if (playtime.timer) timers.push(playtime.timer);
  }
  if ((flags.shopEnabled || flags.starterKitEnabled) && !globalThis[SWEEP_LOOP]) {
    globalThis[SWEEP_LOOP] = true;
    const sweepTimer = setInterval(() => {
      points.sweepRefunds({}).catch((error) => log(`[Nexus Craft] mc refund sweep ${String(error?.message || error).slice(0, 160)}`));
    }, 60 * 1000);
    sweepTimer.unref?.();
    timers.push(sweepTimer);
  }
  if (flags.shopDeliveryEnabled && !flags.dryRun && !globalThis[DELIVERY_LOOP]) {
    globalThis[DELIVERY_LOOP] = true;
    const timer = setInterval(() => {
      defaultRcon(store).then((rcon) => runMcDeliveryCycle({ points, rcon, env })).catch((error) => {
        log(`[Nexus Craft] mc delivery ${String(error?.message || error).slice(0, 160)}`);
      });
    }, 10000);
    timer.unref?.();
    timers.push(timer);
  }
  return { started: true, timers };
}

module.exports = { reasonText, handleMcPointsCommand, installMcEconomyLoops };

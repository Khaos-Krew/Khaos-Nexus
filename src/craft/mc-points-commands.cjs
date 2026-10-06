'use strict';

const { mcPointsFlags } = require('../shared/mc-points-flags.cjs');
const { mcMemberText } = require('../shared/mc-member-text.cjs');
const { mcRefundActorAllowed } = require('../economy-worker/mc-refund-auth.cjs');
const { beginMinecraftLink } = require('./mc-link-flow.cjs');
const { httpMinecraftPoints, economyConfigured } = require('./mc-economy-http.cjs');
const { runRcon } = require('./query.cjs');
const { installMcPlaytimeLoop } = require('./mc-playtime.cjs');
const { runMcDeliveryCycle } = require('./mc-delivery.cjs');

const DELIVERY_LOOP = Symbol.for('khaos.nexus.craft.mc.delivery');
const PLAYTIME_LOOP = Symbol.for('khaos.nexus.craft.mc.playtime');
const SWEEP_LOOP = Symbol.for('khaos.nexus.craft.mc.refund-sweep');

function reasonText(reason) {
  return mcMemberText(reason);
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
  const staffCommand = interaction.commandName === 'mcadmin' || group === 'mcadmin';
  const handled = staffCommand || group === 'link' || sub === 'unlink' || sub === 'shop' || sub === 'starter';
  if (!handled) return false;
  const env = context.env || process.env;
  const points = context.points || pointsFor(env);
  const discordUserId = String(interaction.user?.id || '');
  if (staffCommand) {
    if (!context.isStaff) {
      await interaction.reply(context.ephemeral('Only Nexus staff can use `/mcadmin`. Ask a staff member if you need an order, a link, or a kit checked.'));
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
      await interaction.reply(context.ephemeral(lines.length ? lines.join('\n') : 'No Minecraft orders are waiting.'));
      return true;
    }
    if (sub === 'kits') {
      const grants = await points.listGrants();
      const lines = grants.slice(0, 15).map((grant) => `${grant.orderId} ${grant.status} \`${grant.mcUuid}\``);
      await interaction.reply(context.ephemeral(lines.length ? lines.join('\n') : 'No Starter Kit claims yet.'));
      return true;
    }
    if (sub === 'link-revoke') {
      const result = await points.unlink({
        discordUserId: interaction.options.getString('user'),
        actor: discordUserId,
        reason: 'staff-revoke'
      });
      await interaction.reply(context.ephemeral(result.ok ? `Link revoked. They can link again after ${result.cooldownUntil} with \`/mc link start\`.` : reasonText(result.reason)));
      return true;
    }
    if (sub === 'refund') {
      if (!mcRefundActorAllowed(interaction, env)) {
        await interaction.reply(context.ephemeral(reasonText('staff-not-authorized')));
        return true;
      }
      const orderId = interaction.options.getString('order');
      const reason = interaction.options.getString('reason');
      const result = await points.refund({
        orderId,
        reason,
        actor: discordUserId,
        staffAuthorized: true,
        force: interaction.options.getBoolean?.('force') === true
      });
      if (result?.duplicate) {
        await interaction.reply(context.ephemeral(`Order ${orderId} was already refunded. Nexus Points were not returned again.`));
        return true;
      }
      if (!result?.ok) {
        await interaction.reply(context.ephemeral(reasonText(result?.reason)));
        return true;
      }
      const price = Number(result.order?.price || 0);
      const returned = price > 0 ? `${price} Nexus Points were returned.` : 'No Nexus Points were owed.';
      await interaction.reply(context.ephemeral(`Refunded ${orderId}. ${returned} The audit is stored. This order cannot be refunded again.`));
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
    catch { await interaction.reply(context.ephemeral('I cannot reach the game server yet. Ask a staff member to save the connection with `/mcrcon setup`, then run `/mc link start` again.')); return true; }
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
        ? `I whispered a link code to **${result.mcName}** in Minecraft. It expires in 10 minutes. Do not share it. Run \`/mc link confirm\` and paste the code.`
        : reasonText(result.reason),
      allowedMentions: { parse: [] }
    });
    return true;
  }
  if (group === 'link' && sub === 'confirm') {
    const result = await points.confirm({ discordUserId, code: interaction.options.getString('code') });
    await interaction.reply(context.ephemeral(result.ok ? 'Minecraft is linked. Play on Nexus Craft to earn Points. Check it any time with `/mc link status`.' : reasonText(result.reason)));
    return true;
  }
  if (group === 'link' && sub === 'status') {
    let result;
    try {
      result = await points.status({ discordUserId });
    } catch {
      await interaction.reply(context.ephemeral(reasonText('link-status-unavailable')));
      return true;
    }
    if (!result || result.ok === false) {
      await interaction.reply(context.ephemeral(reasonText(result?.reason || 'link-status-unavailable')));
      return true;
    }
    const text = result.linked
      ? 'Your Minecraft account is linked. Play on Nexus Craft to earn Points.'
      : result.cooldownUntil
        ? `Minecraft is not linked. You can link again after ${result.cooldownUntil}. Run \`/mc link start\` then.`
        : 'Minecraft is not linked. Be online in game, then run `/mc link start`.';
    await interaction.reply(context.ephemeral(text));
    return true;
  }
  if (sub === 'unlink') {
    const result = await points.unlink({ discordUserId });
    await interaction.reply(context.ephemeral(result.ok ? `Minecraft is unlinked. You can link again after ${result.cooldownUntil} with \`/mc link start\`.` : reasonText(result.reason)));
    return true;
  }
  if (sub === 'shop') {
    const flags = mcPointsFlags(env);
    await interaction.reply(context.ephemeral(flags.shopEnabled
      ? 'Open Sentinal and choose the Minecraft shop. This bot does not sell items.'
      : mcMemberText('mc-shop-disabled')));
    return true;
  }
  if (sub === 'starter') {
    await interaction.reply(context.ephemeral(mcPointsFlags(env).starterKitEnabled
      ? 'Open Sentinal and claim the free Starter Kit from the Minecraft section. This bot does not give the kit.'
      : mcMemberText('mc-starter-kit-disabled')));
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

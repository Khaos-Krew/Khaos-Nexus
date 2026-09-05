'use strict';

const http = require('node:http');
const { Client, GatewayIntentBits } = require('discord.js');
const {
  ARN_INTAKE_CHANNEL_NAME,
  discoverNamedWebhooks
} = require('../sentinel/arn-intake-extension.cjs');
const {
  INFO_MARKER,
  BOARD_MARKER,
  replayIntake,
  sortedAnomalies,
  infoEmbed,
  boardEmbed,
  resetArnStateForTest
} = require('../sentinel/arn-live-board-extension.cjs');
const {
  loadArnDedicatedConfig,
  validateArnDedicatedConfig,
  safeConfigSummary
} = require('../arn/dedicated-config.cjs');

const config = loadArnDedicatedConfig();
const validation = validateArnDedicatedConfig(config);
const runtime = {
  startedAt: new Date().toISOString(),
  discordReady: false,
  lastReconcileAt: null,
  lastReconcileOk: false,
  lastError: '',
  tracked: 0,
  recognizedWebhooks: 0,
  maps: []
};

function sanitizeError(error) {
  return String(error?.message || error || 'unknown')
    .replace(/[\r\n\0]+/g, ' ')
    .slice(0, 400);
}

function markerMatch(message, marker) {
  return Boolean(message?.author?.bot) && (message.embeds || []).some((embed) =>
    String(embed?.footer?.text || '').includes(marker)
  );
}

async function findChannel(guild, configuredId, fallbackName) {
  if (configuredId) {
    const configured = await guild.channels.fetch(configuredId).catch(() => null);
    if (configured?.isTextBased?.()) return configured;
  }
  const channels = await guild.channels.fetch();
  return [...channels.values()].find((channel) =>
    channel?.isTextBased?.() && String(channel.name || '').toLowerCase() === fallbackName
  ) || null;
}

async function ensureOwnedPanels(client, publicChannel) {
  const recent = await publicChannel.messages.fetch({ limit: 50 });
  const ownId = String(client.user.id);
  const own = (marker) => recent.find((message) =>
    String(message.author?.id || '') === ownId && markerMatch(message, marker)
  );
  const foreign = [...recent.values()].filter((message) =>
    String(message.author?.id || '') !== ownId &&
    (markerMatch(message, INFO_MARKER) || markerMatch(message, BOARD_MARKER))
  );

  if (config.cutover.cleanupForeignPanels && foreign.length) {
    for (const message of foreign) {
      await message.delete().catch((error) => {
        console.warn(`[ARN] unable to remove legacy Sentinal panel ${message.id}: ${sanitizeError(error)}`);
      });
    }
  }

  let info = own(INFO_MARKER);
  let board = own(BOARD_MARKER);
  if (!info) info = await publicChannel.send({ embeds: [infoEmbed()], allowedMentions: { parse: [] } });
  else await info.edit({ embeds: [infoEmbed()], allowedMentions: { parse: [] } });
  if (!board) board = await publicChannel.send({ embeds: [boardEmbed()], allowedMentions: { parse: [] } });
  else await board.edit({ embeds: [boardEmbed()], allowedMentions: { parse: [] } });

  return { foreignPanels: foreign.length, infoMessageId: String(info.id), boardMessageId: String(board.id) };
}

async function reconcile(client) {
  const guild = await client.guilds.fetch(config.discord.guildId);
  const intake = await findChannel(guild, config.discord.ingestChannelId, ARN_INTAKE_CHANNEL_NAME);
  if (!intake) throw new Error('ARN ingest channel not found. Set ARN_INGEST_CHANNEL_ID.');

  const discovery = await discoverNamedWebhooks(intake, console);
  const replayed = await replayIntake(client, intake);
  const tracked = sortedAnomalies().length;

  runtime.lastReconcileAt = new Date().toISOString();
  runtime.lastReconcileOk = true;
  runtime.lastError = '';
  runtime.tracked = tracked;
  runtime.recognizedWebhooks = discovery.recognized;
  runtime.maps = discovery.maps;

  if (config.mode === 'shadow') {
    console.log(`[ARN] shadow reconcile ok: replayed=${replayed} tracked=${tracked} namedWebhooks=${discovery.recognized} maps=${discovery.maps.join(',') || 'none'}`);
    return;
  }

  const publicChannel = await findChannel(guild, config.discord.publicChannelId, 'arn');
  if (!publicChannel) throw new Error('ARN public channel not found. Set ARN_PUBLIC_CHANNEL_ID.');
  const panels = await ensureOwnedPanels(client, publicChannel);
  console.log(`[ARN] active reconcile ok: replayed=${replayed} tracked=${tracked} namedWebhooks=${discovery.recognized} foreignPanels=${panels.foreignPanels}`);
}

function healthPayload() {
  return {
    service: 'nexus-arn',
    mode: config.mode,
    ok: validation.ok && (config.mode === 'disabled' || runtime.discordReady),
    ready: validation.ok && (config.mode === 'disabled' || (runtime.discordReady && runtime.lastReconcileOk)),
    config: safeConfigSummary(config),
    runtime
  };
}

function startHealthServer() {
  const port = Math.max(1, Number(process.env.PORT || 8080) || 8080);
  const server = http.createServer((req, res) => {
    if (req.url !== '/health' && req.url !== '/ready') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'not-found' }));
      return;
    }
    const payload = healthPayload();
    const ok = req.url === '/ready' ? payload.ready : payload.ok;
    res.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' });
    res.end(JSON.stringify(payload));
  });
  server.listen(port, '0.0.0.0', () => console.log(`[ARN] health server listening on :${port}`));
  return server;
}

async function main() {
  startHealthServer();
  console.log(`[ARN] dedicated service boot: ${JSON.stringify(safeConfigSummary(config))}`);

  if (!validation.ok) {
    console.error(`[ARN] configuration incomplete; missing=${validation.missing.join(',')}`);
    process.exitCode = 1;
    return;
  }
  if (config.mode === 'disabled') {
    console.log('[ARN] service disabled by ARN_MODE=disabled; health endpoint remains available.');
    return;
  }

  resetArnStateForTest();
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
  client.once('ready', async () => {
    runtime.discordReady = true;
    console.log(`[ARN] Discord ready: user=${client.user.tag} mode=${config.mode}`);

    const run = async () => {
      try {
        await reconcile(client);
      } catch (error) {
        runtime.lastReconcileAt = new Date().toISOString();
        runtime.lastReconcileOk = false;
        runtime.lastError = sanitizeError(error);
        console.warn(`[ARN] reconcile failed: ${runtime.lastError}`);
      }
    };

    await run();
    const timer = setInterval(() => void run(), config.polling.intervalMs);
    timer.unref?.();
  });
  client.on('error', (error) => {
    runtime.lastError = sanitizeError(error);
    console.warn(`[ARN] Discord client error: ${runtime.lastError}`);
  });

  await client.login(config.discord.token);
}

void main().catch((error) => {
  runtime.lastError = sanitizeError(error);
  console.error(`[ARN] fatal startup failure: ${runtime.lastError}`);
  process.exitCode = 1;
});

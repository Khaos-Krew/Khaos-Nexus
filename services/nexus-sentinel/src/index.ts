import "dotenv/config";
import { Client, Events, GatewayIntentBits } from "discord.js";

import {
  applyPresence,
  getRequestedPresence,
  readCachedPresence,
  verifyPresenceMatches,
} from "./presence.js";
import { startJobScheduler, notifyGuildSync } from "./jobs.js";
import {
  handleRankCommand,
  registerRankCommand,
  startRankReconciliation,
} from "./rank-sync.js";

const TOKEN = process.env.NEXUS_BOT_TOKEN;
if (!TOKEN) {
  console.error("[boot] NEXUS_BOT_TOKEN missing — aborting.");
  process.exit(1);
}

const CONFIGURED_APP_ID = process.env.NEXUS_BOT_APPLICATION_ID ?? null;
const STARTED_AT = Date.now();

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

function reapplyPresence(reason: string) {
  applyPresence(client);
  console.log(`[presence] reapplied (reason=${reason})`);
}

client.once(Events.ClientReady, async (c) => {
  const readyAt = new Date().toISOString();
  const guildIds = [...c.guilds.cache.keys()];
  console.log(`[ready] Nexus Sentinel logged in as ${c.user.tag} (id=${c.user.id})`);
  console.log(`[gateway] guildCount=${c.guilds.cache.size} shardCount=${c.ws.shards.size} ping=${c.ws.ping}ms readyAt=${readyAt}`);

  try {
    const app = await c.application.fetch();
    const configuredId = CONFIGURED_APP_ID ?? "(unset)";
    const matches = CONFIGURED_APP_ID ? app.id === CONFIGURED_APP_ID : null;
    console.log(`[identity] applicationId=${app.id} configuredApplicationId=${configuredId} matches=${matches}`);
    if (CONFIGURED_APP_ID && app.id !== CONFIGURED_APP_ID) {
      console.error("[identity] Sentinel is authenticated against a different Discord application.");
    }
  } catch (err) {
    console.error("[identity] application.fetch failed:", err);
  }

  console.log(`[guilds] count=${guildIds.length} firstFive=${JSON.stringify(guildIds.slice(0, 5))}`);

  const requested = applyPresence(client);
  setTimeout(() => {
    const cached = readCachedPresence(client);
    console.log(`[presence] verify@5s requested=${JSON.stringify({ status: requested.status, activity: { name: requested.text, type: requested.type } })} cached=${JSON.stringify(cached)}`);
    if (!verifyPresenceMatches(client, requested)) console.warn("[presence] cached presence differs from requested presence");
  }, 5_000);

  const refreshSecs = Number(process.env.PRESENCE_REFRESH_SECONDS ?? 900);
  if (Number.isFinite(refreshSecs) && refreshSecs > 0) setInterval(() => applyPresence(client), refreshSecs * 1000);

  setInterval(() => {
    const mem = process.memoryUsage();
    const cached = readCachedPresence(client);
    const uptimeSec = Math.floor((Date.now() - STARTED_AT) / 1000);
    console.log(`[heartbeat] ok ping=${client.ws.ping}ms guilds=${client.guilds.cache.size} status=${cached.status} rssMB=${(mem.rss / 1024 / 1024).toFixed(1)} heapMB=${(mem.heapUsed / 1024 / 1024).toFixed(1)} uptimeSec=${uptimeSec}`);
  }, 60_000);

  startJobScheduler();
  await registerRankCommand(c);
  await startRankReconciliation(c);
});

client.on(Events.ClientReady, () => reapplyPresence("ready"));
client.on(Events.ShardReady, (shardId, unavailableGuilds) => console.log(`[gateway] shardReady id=${shardId} unavailableGuilds=${unavailableGuilds?.size ?? 0}`));
client.on(Events.ShardDisconnect, (event, shardId) => console.warn(`[gateway] shardDisconnect id=${shardId} code=${event.code} reason=${event.reason}`));
client.on(Events.ShardReconnecting, (shardId) => { console.log(`[gateway] shardReconnecting id=${shardId}`); reapplyPresence("shardReconnecting"); });
client.on(Events.ShardResume, (shardId, replayed) => { console.log(`[gateway] shardResume id=${shardId} replayed=${replayed}`); reapplyPresence("shardResume"); });
client.on(Events.ShardError, (err, shardId) => console.error(`[gateway] shardError id=${shardId}:`, err));
client.on(Events.Invalidated, () => console.error("[gateway] session invalidated"));
client.on(Events.Error, (err) => console.error("[client] error:", err));
client.on(Events.Warn, (msg) => console.warn("[client] warn:", msg));
client.on(Events.InteractionCreate, (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  handleRankCommand(interaction).catch((err) => console.error("[ranks] interaction failed:", err));
});

client.on(Events.GuildCreate, (guild) => {
  console.log(`[guildCreate] joined guild=${guild.id} name=${guild.name} members=${guild.memberCount}`);
  notifyGuildSync([guild.id]).catch((err) => console.error("[guildCreate] notify failed:", err));
});
client.on(Events.GuildUpdate, (_old, guild) => {
  console.log(`[guildUpdate] guild=${guild.id} name=${guild.name}`);
  notifyGuildSync([guild.id]).catch((err) => console.error("[guildUpdate] notify failed:", err));
});
client.on(Events.GuildDelete, (guild) => {
  console.log(`[guildDelete] left guild=${guild.id} name=${guild.name}`);
  notifyGuildSync([guild.id]).catch(() => undefined);
});

process.on("uncaughtException", (err) => console.error("[process] uncaughtException:", err));
process.on("unhandledRejection", (reason) => console.error("[process] unhandledRejection:", reason));

async function shutdown(signal: string) {
  console.log(`[shutdown] received ${signal} — destroying client`);
  try { await client.destroy(); } catch (err) { console.error("[shutdown] error destroying client:", err); }
  process.exit(0);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

console.log(`[boot] starting Nexus Sentinel — requested presence=${JSON.stringify(getRequestedPresence())}`);
client.login(TOKEN).catch((err) => {
  console.error("[boot] login failed:", err);
  process.exit(1);
});

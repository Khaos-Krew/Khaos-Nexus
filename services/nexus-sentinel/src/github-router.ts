import { createHmac, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import {
  ChannelType,
  Client,
  EmbedBuilder,
  type CategoryChannel,
  type Guild,
  type TextChannel,
} from "discord.js";

const DEFAULT_CATEGORY = "Khaos Nexus";
const DEFAULT_ORG = "Khaos-Krew";
const WEBHOOK_PATH = "/github/webhook";
const HEALTH_PATH = "/health";
const DELIVERY_CACHE_LIMIT = 500;
const MAX_BODY_BYTES = 1_000_000;

const seenDeliveries = new Set<string>();
const deliveryOrder: string[] = [];

type GithubPayload = any;

function envList(name: string): string[] {
  return String(process.env[name] ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function githubChannelName(repoFullName: string): string {
  const repo = String(repoFullName).split("/").pop() || "repository";
  const slug = repo
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 91);
  return `github-${slug || "repository"}`;
}

export function verifyGithubSignature(secret: string, rawBody: Buffer, signature: string | undefined): boolean {
  if (!secret || !signature) return false;
  const expected = `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signature);
  return expectedBuffer.length === actualBuffer.length && timingSafeEqual(expectedBuffer, actualBuffer);
}

function rememberDelivery(deliveryId: string | undefined): boolean {
  if (!deliveryId) return true;
  if (seenDeliveries.has(deliveryId)) return false;
  seenDeliveries.add(deliveryId);
  deliveryOrder.push(deliveryId);
  while (deliveryOrder.length > DELIVERY_CACHE_LIMIT) {
    const expired = deliveryOrder.shift();
    if (expired) seenDeliveries.delete(expired);
  }
  return true;
}

function configuredRepositories(): string[] {
  const org = process.env.GITHUB_ORG || DEFAULT_ORG;
  return envList("GITHUB_REPOSITORIES").map((repo) => repo.includes("/") ? repo : `${org}/${repo}`);
}

function repositoryAllowed(repoFullName: string): boolean {
  const org = (process.env.GITHUB_ORG || DEFAULT_ORG).toLowerCase();
  const normalized = repoFullName.toLowerCase();
  if (!normalized.startsWith(`${org}/`)) return false;
  const configured = configuredRepositories();
  return configured.length === 0 || configured.some((repo) => repo.toLowerCase() === normalized);
}

async function resolveGuild(client: Client): Promise<Guild> {
  const configuredGuildId = process.env.GITHUB_DISCORD_GUILD_ID || process.env.NEXUS_DISCORD_GUILD_ID;
  if (configuredGuildId) return client.guilds.fetch(configuredGuildId);
  const cached = client.guilds.cache.first();
  if (cached) return cached;
  const guilds = await client.guilds.fetch();
  const first = guilds.first();
  if (!first) throw new Error("Nexus Sentinel is not connected to a Discord guild.");
  return client.guilds.fetch(first.id);
}

async function ensureCategory(guild: Guild): Promise<CategoryChannel> {
  const categoryName = process.env.GITHUB_DISCORD_CATEGORY || DEFAULT_CATEGORY;
  const existing = guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildCategory && channel.name.toLowerCase() === categoryName.toLowerCase()
  );
  if (existing && existing.type === ChannelType.GuildCategory) return existing;

  const created = await guild.channels.create({
    name: categoryName,
    type: ChannelType.GuildCategory,
    reason: "Nexus Sentinel GitHub progress routing",
  });
  if (created.type !== ChannelType.GuildCategory) throw new Error("Discord did not create the GitHub category as a category channel.");
  return created;
}

async function ensureRepositoryChannel(
  guild: Guild,
  repoFullName: string,
  category?: CategoryChannel,
): Promise<TextChannel> {
  const parent = category || await ensureCategory(guild);
  const name = githubChannelName(repoFullName);
  const topicMarker = `GitHub progress for ${repoFullName} •`;
  const existing = guild.channels.cache.find((channel) => {
    if (channel.type !== ChannelType.GuildText) return false;
    return channel.name === name || String(channel.topic || "").startsWith(topicMarker);
  });

  if (existing && existing.type === ChannelType.GuildText) {
    if (existing.parentId !== parent.id) {
      await existing.setParent(parent.id, { lockPermissions: false, reason: "Keep Sentinel GitHub channels under Khaos Nexus" });
    }
    return existing;
  }

  return guild.channels.create({
    name,
    type: ChannelType.GuildText,
    parent: parent.id,
    topic: `${topicMarker} managed by Nexus Sentinel`,
    reason: `Nexus Sentinel repository channel for ${repoFullName}`,
  });
}

export async function provisionGithubChannels(client: Client): Promise<number> {
  if (!client.isReady()) return 0;
  const guild = await resolveGuild(client);
  const repos = configuredRepositories().filter(repositoryAllowed);
  console.log(`[github] provisioning start guild=${guild.id} repositories=${repos.length}`);
  const category = await ensureCategory(guild);
  console.log(`[github] category ready name=${category.name} id=${category.id}`);

  let createdOrVerified = 0;
  for (const repo of repos) {
    const channel = await ensureRepositoryChannel(guild, repo, category);
    createdOrVerified += 1;
    console.log(`[github] repository channel ready repo=${repo} channel=${channel.name} id=${channel.id}`);
  }

  console.log(`[github] provisioning complete category=${category.name} repositories=${createdOrVerified}`);
  return createdOrVerified;
}

function shortSha(value: unknown): string {
  return String(value || "").slice(0, 7) || "unknown";
}

function actorName(payload: GithubPayload): string {
  return payload?.sender?.login || payload?.pusher?.name || payload?.workflow_run?.actor?.login || "GitHub";
}

function buildGithubEmbed(eventName: string, payload: GithubPayload): EmbedBuilder | null {
  const repoFullName = payload?.repository?.full_name || "Unknown repository";
  const repositoryUrl = payload?.repository?.html_url;
  const embed = new EmbedBuilder()
    .setTitle(repoFullName)
    .setTimestamp(new Date())
    .setFooter({ text: `Nexus Sentinel • ${eventName}` });
  if (repositoryUrl) embed.setURL(repositoryUrl);

  if (eventName === "push") {
    const branch = String(payload?.ref || "").replace("refs/heads/", "") || "unknown";
    const commits = Array.isArray(payload?.commits) ? payload.commits : [];
    const head = payload?.head_commit;
    embed
      .setDescription(`📤 **${actorName(payload)} pushed ${commits.length} commit${commits.length === 1 ? "" : "s"} to \`${branch}\`**`)
      .addFields(
        { name: "Head", value: `\`${shortSha(payload?.after)}\``, inline: true },
        { name: "Branch", value: `\`${branch}\``, inline: true },
        { name: "Latest", value: String(head?.message || commits[commits.length - 1]?.message || "Push received").slice(0, 1024) },
      );
    if (payload?.compare) embed.setURL(payload.compare);
    return embed;
  }

  if (eventName === "pull_request") {
    const pr = payload?.pull_request;
    if (!pr) return null;
    const action = payload?.action || "updated";
    const state = pr?.merged ? "merged" : action;
    embed
      .setDescription(`🔀 **Pull request #${pr.number} ${state}**`)
      .addFields(
        { name: "Title", value: String(pr.title || "Untitled").slice(0, 1024) },
        { name: "Author", value: String(pr.user?.login || actorName(payload)), inline: true },
        { name: "Branch", value: `\`${pr.head?.ref || "unknown"}\` → \`${pr.base?.ref || "unknown"}\``, inline: true },
      );
    if (pr.html_url) embed.setURL(pr.html_url);
    return embed;
  }

  if (eventName === "issues") {
    const issue = payload?.issue;
    if (!issue) return null;
    embed
      .setDescription(`🐛 **Issue #${issue.number} ${payload?.action || "updated"}**`)
      .addFields(
        { name: "Title", value: String(issue.title || "Untitled").slice(0, 1024) },
        { name: "Author", value: String(issue.user?.login || actorName(payload)), inline: true },
        { name: "State", value: String(issue.state || "unknown"), inline: true },
      );
    if (issue.html_url) embed.setURL(issue.html_url);
    return embed;
  }

  if (eventName === "workflow_run") {
    const run = payload?.workflow_run;
    if (!run) return null;
    const conclusion = run.conclusion || run.status || payload?.action || "updated";
    const icon = conclusion === "success" ? "✅" : conclusion === "failure" ? "❌" : "⚙️";
    embed
      .setDescription(`${icon} **Workflow ${conclusion}**`)
      .addFields(
        { name: "Workflow", value: String(run.name || "GitHub Actions").slice(0, 1024) },
        { name: "Branch", value: `\`${run.head_branch || "unknown"}\``, inline: true },
        { name: "Commit", value: `\`${shortSha(run.head_sha)}\``, inline: true },
      );
    if (run.html_url) embed.setURL(run.html_url);
    return embed;
  }

  if (eventName === "release") {
    const release = payload?.release;
    if (!release) return null;
    embed
      .setDescription(`📦 **Release ${payload?.action || "updated"}**`)
      .addFields(
        { name: "Release", value: String(release.name || release.tag_name || "Unnamed release").slice(0, 1024) },
        { name: "Tag", value: `\`${release.tag_name || "unknown"}\``, inline: true },
        { name: "Author", value: String(release.author?.login || actorName(payload)), inline: true },
      );
    if (release.html_url) embed.setURL(release.html_url);
    return embed;
  }

  if (eventName === "deployment_status") {
    const status = payload?.deployment_status;
    const deployment = payload?.deployment;
    if (!status) return null;
    const state = status.state || "updated";
    const icon = state === "success" ? "🚀" : state === "failure" || state === "error" ? "❌" : "🛰️";
    embed
      .setDescription(`${icon} **Deployment ${state}**`)
      .addFields(
        { name: "Environment", value: String(deployment?.environment || status.environment || "default"), inline: true },
        { name: "Commit", value: `\`${shortSha(deployment?.sha)}\``, inline: true },
      );
    if (status.target_url) embed.setURL(status.target_url);
    return embed;
  }

  return null;
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new Error("GitHub webhook body exceeds 1 MB limit.");
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function writeJson(res: ServerResponse, statusCode: number, body: Record<string, unknown>) {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, { "content-type": "application/json; charset=utf-8" });
  res.end(json);
}

async function handleWebhook(client: Client, req: IncomingMessage, res: ServerResponse) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET || "";
  if (!secret) {
    writeJson(res, 503, { ok: false, error: "github_webhook_secret_not_configured" });
    return;
  }

  const rawBody = await readBody(req);
  const signature = headerValue(req.headers["x-hub-signature-256"]);
  if (!verifyGithubSignature(secret, rawBody, signature)) {
    writeJson(res, 401, { ok: false, error: "invalid_signature" });
    return;
  }

  const eventName = headerValue(req.headers["x-github-event"]) || "unknown";
  const deliveryId = headerValue(req.headers["x-github-delivery"]);
  if (!rememberDelivery(deliveryId)) {
    writeJson(res, 202, { ok: true, duplicate: true });
    return;
  }

  let payload: GithubPayload;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    writeJson(res, 400, { ok: false, error: "invalid_json" });
    return;
  }

  if (eventName === "ping") {
    if (client.isReady()) await provisionGithubChannels(client);
    writeJson(res, 200, { ok: true, pong: true });
    return;
  }

  const repoFullName = String(payload?.repository?.full_name || "");
  if (!repoFullName || !repositoryAllowed(repoFullName)) {
    writeJson(res, 202, { ok: true, ignored: "repository_not_routed" });
    return;
  }

  const embed = buildGithubEmbed(eventName, payload);
  if (!embed) {
    writeJson(res, 202, { ok: true, ignored: "event_not_routed" });
    return;
  }

  if (!client.isReady()) {
    writeJson(res, 503, { ok: false, error: "discord_not_ready" });
    return;
  }

  const guild = await resolveGuild(client);
  const channel = await ensureRepositoryChannel(guild, repoFullName);
  await channel.send({ embeds: [embed] });
  console.log(`[github] routed event=${eventName} repo=${repoFullName} delivery=${deliveryId || "unknown"} channel=${channel.id}`);
  writeJson(res, 202, { ok: true, routed: true, event: eventName, repository: repoFullName });
}

export function startGithubRouter(client: Client): Server {
  const port = Number(process.env.PORT || 3000);
  const server = createServer((req, res) => {
    void (async () => {
      const path = String(req.url || "").split("?")[0];
      if (req.method === "GET" && path === HEALTH_PATH) {
        writeJson(res, 200, {
          ok: true,
          service: "nexus-sentinel",
          discordReady: client.isReady(),
          githubWebhookConfigured: Boolean(process.env.GITHUB_WEBHOOK_SECRET),
          category: process.env.GITHUB_DISCORD_CATEGORY || DEFAULT_CATEGORY,
          repositories: configuredRepositories().length,
        });
        return;
      }
      if (req.method === "POST" && path === WEBHOOK_PATH) {
        await handleWebhook(client, req, res);
        return;
      }
      writeJson(res, 404, { ok: false, error: "not_found" });
    })().catch((error) => {
      console.error("[github] webhook handler failed:", error);
      if (!res.headersSent) writeJson(res, 500, { ok: false, error: "internal_error" });
      else res.end();
    });
  });

  server.listen(port, "0.0.0.0", () => {
    console.log(`[github] router listening on 0.0.0.0:${port}${WEBHOOK_PATH}`);
  });
  server.on("error", (error) => console.error("[github] http server error:", error));
  return server;
}

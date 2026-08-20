import {
  ChannelType,
  ChatInputCommandInteraction,
  Client,
  MessageFlags,
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Guild,
  type TextChannel,
} from "discord.js";

const DEFAULT_CATEGORY = "Khaos Nexus";
const DEFAULT_CHANNEL = "daily-project-reports";
const DEFAULT_TIMEZONE = "America/Chicago";
const DEFAULT_TIMES = ["07:00", "18:00"];
const DEFAULT_LOOKBACK_HOURS = 14;
const DEFAULT_GRACE_MINUTES = 10;
const REPORT_TOPIC = "Khaos Nexus project reports • 7:00 AM & 6:00 PM Central • managed by Nexus Sentinel";

let schedulerStarted = false;
let schedulerTimer: NodeJS.Timeout | null = null;

type GithubRepo = {
  full_name: string;
  html_url: string;
  updated_at: string;
  pushed_at: string | null;
  archived: boolean;
};

type GithubSearchItem = {
  number: number;
  title: string;
  html_url: string;
  state: string;
  draft?: boolean;
  updated_at: string;
  repository_url?: string;
  pull_request?: unknown;
};

type GithubSearchResult = {
  total_count: number;
  items: GithubSearchItem[];
};

type GithubCommit = {
  sha: string;
  html_url: string;
  commit?: {
    message?: string;
    author?: { date?: string | null } | null;
    committer?: { date?: string | null } | null;
  };
};

type GithubWorkflowRun = {
  id: number;
  name: string;
  html_url: string;
  status: string;
  conclusion: string | null;
  head_branch: string | null;
  head_sha: string;
  updated_at: string;
};

type GithubWorkflowRuns = { workflow_runs: GithubWorkflowRun[] };

type GithubRelease = {
  id: number;
  name: string | null;
  tag_name: string;
  html_url: string;
  published_at: string | null;
  created_at: string;
  draft: boolean;
  prerelease: boolean;
};

type RepoSnapshot = {
  repo: GithubRepo;
  commits: GithubCommit[];
  workflows: GithubWorkflowRun[];
  releases: GithubRelease[];
};

export const projectReportCommand = new SlashCommandBuilder()
  .setName("report")
  .setDescription("Post or inspect the Khaos Nexus project report")
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
  .setDMPermission(false)
  .addSubcommand((command) => command.setName("now").setDescription("Generate and post the project report now"))
  .addSubcommand((command) => command.setName("status").setDescription("Show the report channel and schedule"));

function configuredCategory(): string {
  return String(process.env.GITHUB_DISCORD_CATEGORY || DEFAULT_CATEGORY).trim() || DEFAULT_CATEGORY;
}

function configuredChannel(): string {
  const raw = String(process.env.PROJECT_REPORT_CHANNEL || DEFAULT_CHANNEL).trim().toLowerCase();
  return raw
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 100) || DEFAULT_CHANNEL;
}

export function parseReportTimes(raw = process.env.PROJECT_REPORT_TIMES || DEFAULT_TIMES.join(",")): string[] {
  const parsed = String(raw)
    .split(",")
    .map((value) => value.trim())
    .filter((value) => /^\d{2}:\d{2}$/.test(value))
    .filter((value) => {
      const [hour, minute] = value.split(":").map(Number);
      return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59;
    });
  return [...new Set(parsed.length ? parsed : DEFAULT_TIMES)].sort();
}

function timezone(): string {
  return String(process.env.PROJECT_REPORT_TIMEZONE || DEFAULT_TIMEZONE).trim() || DEFAULT_TIMEZONE;
}

function lookbackHours(): number {
  const value = Number(process.env.PROJECT_REPORT_LOOKBACK_HOURS ?? DEFAULT_LOOKBACK_HOURS);
  return Number.isFinite(value) && value > 0 ? Math.min(value, 168) : DEFAULT_LOOKBACK_HOURS;
}

function graceMinutes(): number {
  const value = Number(process.env.PROJECT_REPORT_GRACE_MINUTES ?? DEFAULT_GRACE_MINUTES);
  return Number.isFinite(value) && value >= 0 ? Math.min(value, 60) : DEFAULT_GRACE_MINUTES;
}

function localParts(now: Date, zone: string) {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

export function scheduledReportSlot(
  now = new Date(),
  zone = timezone(),
  times = parseReportTimes(),
  grace = graceMinutes(),
): string | null {
  const local = localParts(now, zone);
  const nowMinutes = local.hour * 60 + local.minute;
  let candidate: string | null = null;
  let candidateMinutes = -1;
  for (const time of times) {
    const [hour, minute] = time.split(":").map(Number);
    const targetMinutes = hour * 60 + minute;
    if (nowMinutes >= targetMinutes && nowMinutes <= targetMinutes + grace && targetMinutes > candidateMinutes) {
      candidate = `${local.date}T${time}`;
      candidateMinutes = targetMinutes;
    }
  }
  return candidate;
}

function formatLocal(now = new Date()): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: timezone(),
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(now);
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

async function ensureReportChannel(guild: Guild): Promise<TextChannel> {
  await guild.channels.fetch();
  const categoryName = configuredCategory();
  let category = guild.channels.cache.find(
    (channel) => channel.type === ChannelType.GuildCategory && channel.name.toLowerCase() === categoryName.toLowerCase(),
  );
  if (!category) {
    category = await guild.channels.create({
      name: categoryName,
      type: ChannelType.GuildCategory,
      reason: "Nexus Sentinel GitHub and project reporting",
    });
  }
  if (category.type !== ChannelType.GuildCategory) throw new Error("Configured report category is not a Discord category.");

  const channelName = configuredChannel();
  let channel = guild.channels.cache.find(
    (item) => item.type === ChannelType.GuildText && item.name === channelName,
  );
  if (!channel) {
    channel = await guild.channels.create({
      name: channelName,
      type: ChannelType.GuildText,
      parent: category.id,
      topic: REPORT_TOPIC,
      reason: "Nexus Sentinel scheduled project reports",
    });
  }
  if (channel.type !== ChannelType.GuildText) throw new Error("Configured report channel is not a text channel.");
  if (channel.parentId !== category.id) {
    await channel.setParent(category.id, { lockPermissions: false, reason: "Keep project reports beside GitHub progress channels" });
  }
  if (channel.topic !== REPORT_TOPIC) await channel.setTopic(REPORT_TOPIC);
  return channel;
}

export async function provisionProjectReportChannel(client: Client): Promise<TextChannel | null> {
  if (!client.isReady()) return null;
  const guild = await resolveGuild(client);
  const channel = await ensureReportChannel(guild);
  console.log(`[report] channel ready category=${configuredCategory()} channel=${channel.name} id=${channel.id}`);
  return channel;
}

function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "User-Agent": "Khaos-Nexus-Sentinel",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  const token = process.env.GITHUB_REPORT_TOKEN || process.env.GITHUB_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function githubJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: githubHeaders() });
  if (!response.ok) {
    const remaining = response.headers.get("x-ratelimit-remaining");
    throw new Error(`GitHub API ${response.status} for ${url}${remaining !== null ? ` (rate remaining=${remaining})` : ""}`);
  }
  return response.json() as Promise<T>;
}

function repoNameFromApiUrl(repositoryUrl?: string): string {
  return String(repositoryUrl || "").split("/repos/")[1] || "unknown";
}

function short(value: string, max = 90): string {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  return normalized.length > max ? `${normalized.slice(0, max - 1)}…` : normalized;
}

function shortSha(value: string): string {
  return value.slice(0, 7) || "unknown";
}

function markdownLink(label: string, url: string): string {
  const safeLabel = label.replace(/[\[\]]/g, "");
  return `[${safeLabel}](${url})`;
}

async function collectRepoSnapshot(repo: GithubRepo, sinceIso: string): Promise<RepoSnapshot> {
  const encoded = encodeURIComponent(repo.full_name);
  const [commits, workflows, releases] = await Promise.all([
    githubJson<GithubCommit[]>(`https://api.github.com/repos/${encoded}/commits?since=${encodeURIComponent(sinceIso)}&per_page=10`).catch(() => []),
    githubJson<GithubWorkflowRuns>(`https://api.github.com/repos/${encoded}/actions/runs?per_page=10`).then((data) => data.workflow_runs).catch(() => []),
    githubJson<GithubRelease[]>(`https://api.github.com/repos/${encoded}/releases?per_page=5`).catch(() => []),
  ]);
  const sinceMs = Date.parse(sinceIso);
  return {
    repo,
    commits: commits.filter((commit) => Date.parse(commit.commit?.committer?.date || commit.commit?.author?.date || "") >= sinceMs),
    workflows: workflows.filter((run) => Date.parse(run.updated_at) >= sinceMs),
    releases: releases.filter((release) => Date.parse(release.published_at || release.created_at) >= sinceMs),
  };
}

async function collectProjectData() {
  const org = String(process.env.GITHUB_ORG || "Khaos-Krew").trim() || "Khaos-Krew";
  const hours = lookbackHours();
  const since = new Date(Date.now() - hours * 60 * 60 * 1000);
  const sinceIso = since.toISOString();
  const repos = await githubJson<GithubRepo[]>(`https://api.github.com/orgs/${encodeURIComponent(org)}/repos?per_page=100&sort=updated&direction=desc`);
  const activeRepos = repos
    .filter((repo) => !repo.archived && Math.max(Date.parse(repo.updated_at), Date.parse(repo.pushed_at || "")) >= since.getTime())
    .slice(0, 8);

  const querySince = sinceIso;
  const prQuery = encodeURIComponent(`org:${org} is:pr updated:>=${querySince}`);
  const issueQuery = encodeURIComponent(`org:${org} is:issue updated:>=${querySince}`);
  const [prs, issues, snapshots] = await Promise.all([
    githubJson<GithubSearchResult>(`https://api.github.com/search/issues?q=${prQuery}&sort=updated&order=desc&per_page=25`).catch(() => ({ total_count: 0, items: [] })),
    githubJson<GithubSearchResult>(`https://api.github.com/search/issues?q=${issueQuery}&sort=updated&order=desc&per_page=25`).catch(() => ({ total_count: 0, items: [] })),
    Promise.all(activeRepos.map((repo) => collectRepoSnapshot(repo, sinceIso))),
  ]);
  return { org, hours, sinceIso, repos, activeRepos, prs, issues, snapshots };
}

export async function buildProjectReport(): Promise<string> {
  const generatedAt = new Date();
  const data = await collectProjectData();
  const lines: string[] = [];
  lines.push(`# 🛡️ Khaos Nexus Project Report`);
  lines.push(`Generated **${formatLocal(generatedAt)}** • GitHub organization **${data.org}** • lookback **${data.hours}h**`);
  lines.push("");

  lines.push("## 📌 Executive status");
  const allWorkflows = data.snapshots.flatMap((snapshot) => snapshot.workflows.map((run) => ({ repo: snapshot.repo.full_name, run })));
  const failed = allWorkflows.filter(({ run }) => run.conclusion === "failure" || run.conclusion === "cancelled" || run.conclusion === "timed_out");
  const running = allWorkflows.filter(({ run }) => run.status !== "completed");
  const commits = data.snapshots.reduce((sum, snapshot) => sum + snapshot.commits.length, 0);
  const releases = data.snapshots.flatMap((snapshot) => snapshot.releases.map((release) => ({ repo: snapshot.repo.full_name, release })));
  lines.push(`- Active repositories: **${data.activeRepos.length}** / ${data.repos.filter((repo) => !repo.archived).length}`);
  lines.push(`- Recent commits captured: **${commits}**`);
  lines.push(`- PRs updated: **${data.prs.total_count}** • Issues updated: **${data.issues.total_count}**`);
  lines.push(`- Workflows: **${allWorkflows.length} recent** • **${failed.length} failed/cancelled** • **${running.length} running**`);
  lines.push(`- Releases observed: **${releases.length}**`);
  lines.push("");

  lines.push("## 🔧 Repository activity");
  if (!data.snapshots.length) {
    lines.push("- No repository activity was detected in the report window.");
  } else {
    for (const snapshot of data.snapshots) {
      const latest = snapshot.commits[0];
      const detail = latest ? ` • ${snapshot.commits.length} commit${snapshot.commits.length === 1 ? "" : "s"} • latest \`${shortSha(latest.sha)}\` ${short(latest.commit?.message || "")}` : " • metadata/activity update";
      lines.push(`- ${markdownLink(snapshot.repo.full_name, snapshot.repo.html_url)}${detail}`);
    }
  }
  lines.push("");

  lines.push("## 🔀 Pull requests");
  const recentPrs = data.prs.items.slice(0, 10);
  if (!recentPrs.length) lines.push("- No pull requests updated in the report window.");
  for (const pr of recentPrs) {
    const repo = repoNameFromApiUrl(pr.repository_url);
    lines.push(`- ${markdownLink(`${repo} #${pr.number}`, pr.html_url)} — ${short(pr.title, 110)} • ${pr.state}${pr.draft ? " • draft" : ""}`);
  }
  lines.push("");

  lines.push("## 🐛 Issues / blockers");
  const recentIssues = data.issues.items.slice(0, 10);
  if (!recentIssues.length) lines.push("- No issues updated in the report window.");
  for (const issue of recentIssues) {
    const repo = repoNameFromApiUrl(issue.repository_url);
    lines.push(`- ${markdownLink(`${repo} #${issue.number}`, issue.html_url)} — ${short(issue.title, 110)} • ${issue.state}`);
  }
  lines.push("");

  lines.push("## ✅ CI / deployment signals");
  if (!allWorkflows.length) lines.push("- No recent GitHub Actions workflow updates were detected.");
  for (const item of [...failed, ...running, ...allWorkflows.filter(({ run }) => run.status === "completed" && run.conclusion === "success")].slice(0, 12)) {
    const state = item.run.status === "completed" ? (item.run.conclusion || "completed") : item.run.status;
    const icon = state === "success" ? "✅" : state === "failure" || state === "cancelled" || state === "timed_out" ? "❌" : "⚙️";
    lines.push(`- ${icon} ${markdownLink(`${item.repo} • ${item.run.name}`, item.run.html_url)} — **${state}** • \`${item.run.head_branch || "unknown"}\` • \`${shortSha(item.run.head_sha)}\``);
  }
  lines.push("");

  lines.push("## 📦 Releases");
  if (!releases.length) lines.push("- No new releases were observed in the report window.");
  for (const item of releases.slice(0, 8)) {
    const label = item.release.name || item.release.tag_name;
    lines.push(`- ${markdownLink(`${item.repo} • ${label}`, item.release.html_url)} — \`${item.release.tag_name}\`${item.release.prerelease ? " • prerelease" : ""}${item.release.draft ? " • draft" : ""}`);
  }
  lines.push("");

  lines.push("## 🚨 Attention required");
  if (failed.length) {
    for (const item of failed.slice(0, 6)) lines.push(`- Investigate ${markdownLink(`${item.repo} • ${item.run.name}`, item.run.html_url)} (${item.run.conclusion}).`);
  } else {
    lines.push("- No failed/cancelled workflows were detected in the report window.");
  }
  if (running.length) lines.push(`- ${running.length} workflow${running.length === 1 ? " is" : "s are"} still running; Sentinel will pick up the completed state in the next report.`);
  lines.push("");

  lines.push("## ➡️ Next pass");
  lines.push("- Re-check updated PRs/issues, CI, deployments, and releases at the next scheduled report.");
  lines.push("- GitHub repository progress remains routed into the per-repository channels in this same Discord category.");
  return lines.join("\n");
}

function splitForDiscord(text: string, maxLength = 1900): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of text.split("\n")) {
    const addition = current ? `\n${line}` : line;
    if ((current + addition).length <= maxLength) {
      current += addition;
      continue;
    }
    if (current) chunks.push(current);
    if (line.length <= maxLength) {
      current = line;
      continue;
    }
    for (let index = 0; index < line.length; index += maxLength) chunks.push(line.slice(index, index + maxLength));
    current = "";
  }
  if (current) chunks.push(current);
  return chunks;
}

async function slotAlreadyPosted(channel: TextChannel, slot: string): Promise<boolean> {
  const messages = await channel.messages.fetch({ limit: 25 });
  return messages.some((message) => message.author.id === channel.client.user?.id && message.content.includes(`Scheduled slot: ${slot}`));
}

export async function postProjectReport(client: Client, slot?: string): Promise<TextChannel> {
  if (!client.isReady()) throw new Error("Discord client is not ready.");
  const guild = await resolveGuild(client);
  const channel = await ensureReportChannel(guild);
  if (slot && await slotAlreadyPosted(channel, slot)) {
    console.log(`[report] slot already posted slot=${slot} channel=${channel.id}`);
    return channel;
  }
  const report = await buildProjectReport();
  const marker = slot ? `\n\n🕒 Scheduled slot: ${slot} ${timezone()}` : "";
  const chunks = splitForDiscord(report + marker);
  for (const chunk of chunks) {
    await channel.send({ content: chunk, allowedMentions: { parse: [] } });
  }
  console.log(`[report] posted chunks=${chunks.length} slot=${slot || "manual"} channel=${channel.id}`);
  return channel;
}

async function runScheduledTick(client: Client): Promise<void> {
  const slot = scheduledReportSlot();
  if (!slot) return;
  try {
    await postProjectReport(client, slot);
  } catch (error) {
    console.error(`[report] scheduled post failed slot=${slot}:`, error);
  }
}

export async function registerProjectReportCommand(client: Client<true>): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    const commands = await guild.commands.fetch();
    const existing = commands.find((command) => command.name === projectReportCommand.name);
    if (existing) await guild.commands.edit(existing, projectReportCommand.toJSON());
    else await guild.commands.create(projectReportCommand.toJSON());
  }
}

export async function handleProjectReportCommand(interaction: ChatInputCommandInteraction): Promise<boolean> {
  if (interaction.commandName !== projectReportCommand.name) return false;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    if (!interaction.guild) {
      await interaction.editReply("Project reports can only be managed inside a Discord server.");
      return true;
    }
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "status") {
      const channel = await ensureReportChannel(interaction.guild);
      await interaction.editReply(`Project reports post to <#${channel.id}> under **${configuredCategory()}** at **${parseReportTimes().join(" and ")} ${timezone()}**.`);
      return true;
    }
    const channel = await postProjectReport(interaction.client);
    await interaction.editReply(`Project report posted to <#${channel.id}>.`);
  } catch (error) {
    console.error("[report] command failed:", error);
    await interaction.editReply(`Project report failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }
  return true;
}

export async function startProjectReportScheduler(client: Client<true>): Promise<void> {
  if (schedulerStarted) return;
  schedulerStarted = true;
  await provisionProjectReportChannel(client);
  console.log(`[report] scheduler enabled times=${parseReportTimes().join(",")} timezone=${timezone()} graceMinutes=${graceMinutes()}`);
  await runScheduledTick(client);
  schedulerTimer = setInterval(() => void runScheduledTick(client), 30_000);
  schedulerTimer.unref?.();
}

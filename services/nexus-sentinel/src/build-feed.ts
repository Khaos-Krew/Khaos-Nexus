import {
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  type CategoryChannel,
  type Guild,
  type TextChannel,
} from "discord.js";

const REPOSITORY = "Khaos-Krew/Khaos-Nexus";
const DEFAULT_CATEGORY = "Khaos Nexus";
const CHANNEL_NAME = "nexus-builds";
const CHANNEL_TOPIC = "Nexus Sentinel owner-test downloads, beta announcements, and released Khaos Nexus versions.";
const DEFAULT_CHECK_SECONDS = 300;
const INITIAL_RECOVERY_WINDOW_MS = 30 * 60 * 1000;
const RUN_LOOKBACK_MS = 72 * 60 * 60 * 1000;
const MAX_RECENT_MESSAGE_SCAN = 100;

type GithubRun = {
  id: number;
  name?: string;
  status?: string;
  conclusion?: string | null;
  head_branch?: string;
  head_sha?: string;
  html_url?: string;
  updated_at?: string;
  run_attempt?: number;
};

type GithubArtifact = {
  id: number;
  name?: string;
  expired?: boolean;
  created_at?: string;
};

type GithubRelease = {
  id: number;
  name?: string;
  tag_name?: string;
  body?: string;
  draft?: boolean;
  prerelease?: boolean;
  html_url?: string;
  published_at?: string | null;
  assets?: Array<{ name?: string; browser_download_url?: string }>;
};

type RunGroup = {
  sha: string;
  branch: string;
  runs: GithubRun[];
  updatedAt: string;
};

function truncate(value: unknown, limit: number): string {
  const text = String(value ?? "");
  return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
}

function shortSha(value: unknown): string {
  return String(value || "").slice(0, 12) || "unknown";
}

function checkIntervalMs(): number {
  const seconds = Number(process.env.BUILD_FEED_CHECK_SECONDS ?? DEFAULT_CHECK_SECONDS);
  const bounded = Number.isFinite(seconds) ? Math.min(3600, Math.max(60, Math.round(seconds))) : DEFAULT_CHECK_SECONDS;
  return bounded * 1000;
}

export function isCandidateRun(run: GithubRun): boolean {
  const name = String(run.name || "");
  const branch = String(run.head_branch || "");
  const workflowMatch = /Windows Build|Android Owner Test|Android Build|Owner Test|Beta Build|Release Candidate/i.test(name);
  const branchMatch = /owner-test|beta|release-candidate|candidate|(?:^|[\/_.-])rc(?:$|[\/_.-])/i.test(branch);
  return workflowMatch && (branchMatch || /Owner Test|Beta Build|Release Candidate/i.test(name));
}

export function artifactLooksTestable(artifact: GithubArtifact): boolean {
  const name = String(artifact.name || "");
  if (!name || artifact.expired === true) return false;
  if (/test-output|smoke-output|diagnostic|audit|checksums?|manifest/i.test(name)) return false;
  return /Khaos[- ]Nexus|Android|Mobile|Windows|APK|Setup|Portable/i.test(name);
}

export function platformsForArtifacts(artifacts: GithubArtifact[]): string[] {
  const names = artifacts.map((artifact) => String(artifact.name || "")).join(" ");
  const platforms: string[] = [];
  if (/Android|Mobile|APK/i.test(names)) platforms.push("Android");
  if (/Windows|Setup|Portable/i.test(names)) platforms.push("Windows");
  return platforms.length ? platforms : ["General"];
}

export function testChecklist(platforms: string[], branch = ""): string[] {
  const steps: string[] = [];
  if (platforms.includes("Windows")) {
    steps.push("Install/update the Windows candidate and confirm Khaos Nexus opens without a blank, black, or stuck loading window.");
    steps.push("Check sidebar navigation, independent scrolling, settings persistence, Discord sign-in, and Nexus Sentinel supervision.");
    steps.push("Exercise the feature/regression area represented by this build and verify existing core controls still work.");
  }
  if (platforms.includes("Android")) {
    steps.push("Install the APK, launch it, and verify startup/navigation remain responsive after background and resume.");
    steps.push("Verify pairing/login, secure connection state, current-functions display, status data, and expected permissions.");
  }
  if (platforms.includes("Windows") && platforms.includes("Android")) {
    steps.push("Pair Android to the matching Windows owner-test build and verify Mobile Gateway handshake and live status end to end.");
  }
  if (platforms.includes("General")) {
    steps.push("Install or launch the candidate and smoke-test startup, navigation, and the feature changed on this branch.");
  }
  if (/owner-test|beta|release-candidate|candidate/i.test(branch)) {
    steps.push("Reply in this channel with ✅ PASS or ❌ FAIL; on failure include the failed step and a screenshot/log when available.");
  }
  return steps.slice(0, 7);
}

export function releaseKind(release: GithubRelease): "beta" | "release" {
  const tag = String(release.tag_name || release.name || "");
  return release.prerelease === true || /(?:beta|alpha|\brc\b|-B(?:$|[.-]))/i.test(tag) ? "beta" : "release";
}

function githubHeaders(): Record<string, string> {
  const token = String(process.env.GITHUB_API_TOKEN || process.env.GITHUB_TOKEN || "").trim();
  return {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "Khaos-Nexus-Sentinel",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function githubGet<T>(path: string): Promise<T> {
  const response = await fetch(`https://api.github.com/repos/${REPOSITORY}${path}`, { headers: githubHeaders() });
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path}`);
  return response.json() as Promise<T>;
}

async function resolveGuild(client: Client): Promise<Guild> {
  const configured = process.env.GITHUB_DISCORD_GUILD_ID || process.env.NEXUS_DISCORD_GUILD_ID;
  if (configured) return client.guilds.fetch(configured);
  const cached = client.guilds.cache.first();
  if (cached) return cached;
  const guilds = await client.guilds.fetch();
  const first = guilds.first();
  if (!first) throw new Error("Nexus Sentinel is not connected to a Discord guild.");
  return client.guilds.fetch(first.id);
}

async function ensureCategory(guild: Guild): Promise<CategoryChannel> {
  const name = process.env.GITHUB_DISCORD_CATEGORY || DEFAULT_CATEGORY;
  const existing = guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildCategory && channel.name.toLowerCase() === name.toLowerCase()
  );
  if (existing?.type === ChannelType.GuildCategory) return existing;
  const created = await guild.channels.create({
    name,
    type: ChannelType.GuildCategory,
    reason: "Nexus Sentinel build testing and release feed",
  });
  if (created.type !== ChannelType.GuildCategory) throw new Error("Discord did not create the Nexus build category correctly.");
  return created;
}

export async function provisionBuildFeedChannel(client: Client): Promise<TextChannel> {
  if (!client.isReady()) throw new Error("Discord is not ready.");
  const guild = await resolveGuild(client);
  await guild.channels.fetch();
  const category = await ensureCategory(guild);
  const existing = guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildText && channel.name.toLowerCase() === CHANNEL_NAME
  );
  if (existing?.type === ChannelType.GuildText) {
    if (existing.parentId !== category.id) {
      await existing.setParent(category.id, { lockPermissions: false, reason: "Keep Nexus build feed under Khaos Nexus" });
    }
    if (existing.topic !== CHANNEL_TOPIC) await existing.setTopic(CHANNEL_TOPIC);
    return existing;
  }
  const created = await guild.channels.create({
    name: CHANNEL_NAME,
    type: ChannelType.GuildText,
    parent: category.id,
    topic: CHANNEL_TOPIC,
    reason: "Nexus Sentinel build testing and release feed",
  });
  if (created.type !== ChannelType.GuildText) throw new Error("Discord did not create #nexus-builds as a text channel.");
  return created;
}

function footerKey(text: string | null | undefined): string | null {
  const match = String(text || "").match(/Nexus Sentinel • ((?:build|release):[^\s]+)/);
  return match?.[1] || null;
}

async function seedSeenKeys(channel: TextChannel, seen: Set<string>): Promise<void> {
  try {
    const messages = await channel.messages.fetch({ limit: MAX_RECENT_MESSAGE_SCAN });
    for (const message of messages.values()) {
      for (const embed of message.embeds) {
        const key = footerKey(embed.footer?.text);
        if (key) seen.add(key);
      }
    }
  } catch (error) {
    console.warn("[build-feed] unable to scan recent Discord messages for dedupe:", error);
  }
}

function groupRuns(runs: GithubRun[], now = Date.now()): RunGroup[] {
  const cutoff = now - RUN_LOOKBACK_MS;
  const groups = new Map<string, Map<string, GithubRun>>();
  for (const run of runs) {
    const updated = new Date(run.updated_at || 0).getTime();
    if (!isCandidateRun(run) || !run.head_sha || !Number.isFinite(updated) || updated < cutoff) continue;
    const byWorkflow = groups.get(run.head_sha) || new Map<string, GithubRun>();
    const workflow = String(run.name || `run-${run.id}`);
    const current = byWorkflow.get(workflow);
    if (!current || Number(run.id) > Number(current.id)) byWorkflow.set(workflow, run);
    groups.set(run.head_sha, byWorkflow);
  }
  return [...groups.entries()].map(([sha, byWorkflow]) => {
    const selected = [...byWorkflow.values()];
    const updatedAt = selected.map((run) => run.updated_at || "").sort().at(-1) || new Date(0).toISOString();
    return { sha, branch: selected[0]?.head_branch || "unknown", runs: selected, updatedAt };
  }).sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

async function artifactsForRun(run: GithubRun): Promise<GithubArtifact[]> {
  const payload = await githubGet<{ artifacts?: GithubArtifact[] }>(`/actions/runs/${run.id}/artifacts?per_page=100`);
  return (payload.artifacts || []).filter(artifactLooksTestable);
}

function buildDownloadLink(runId: number, artifact: GithubArtifact): string {
  return `https://github.com/${REPOSITORY}/actions/runs/${runId}/artifacts/${artifact.id}`;
}

function buildTestingEmbed(group: RunGroup, artifacts: Array<GithubArtifact & { runId: number }>): EmbedBuilder {
  const platforms = platformsForArtifacts(artifacts);
  const downloads = artifacts.slice(0, 8).map((artifact) =>
    `[${truncate(artifact.name || "Build artifact", 80)}](${buildDownloadLink(artifact.runId, artifact)})`
  ).join("\n");
  const checklist = testChecklist(platforms, group.branch).map((step) => `• ${step}`).join("\n");
  const workflowNames = [...new Set(group.runs.map((run) => String(run.name || "Build")))].join(", ");
  const runUrl = group.runs.find((run) => run.html_url)?.html_url;
  return new EmbedBuilder()
    .setTitle(`🧪 Testing Needed • Khaos Nexus ${shortSha(group.sha)}`)
    .setDescription("A successful owner-test/beta candidate is ready for manual validation before promotion.")
    .setColor(0xf1b94f)
    .addFields(
      { name: "Platforms", value: platforms.join(" + "), inline: true },
      { name: "Branch", value: `\`${truncate(group.branch, 80)}\``, inline: true },
      { name: "Commit", value: `\`${shortSha(group.sha)}\``, inline: true },
      { name: "Build workflows", value: truncate(workflowNames, 1024) || "Build", inline: false },
      { name: "What to test", value: truncate(checklist, 1024), inline: false },
      { name: "Download and test", value: truncate(downloads, 1024), inline: false },
      ...(runUrl ? [{ name: "CI evidence", value: `[Open successful workflow run](${runUrl})`, inline: false }] : []),
    )
    .setFooter({ text: `Nexus Sentinel • build:${group.sha}` })
    .setTimestamp(new Date(group.updatedAt));
}

function buildReleaseEmbed(release: GithubRelease): EmbedBuilder {
  const kind = releaseKind(release);
  const tag = String(release.tag_name || release.name || "Unknown version");
  const downloads = (release.assets || [])
    .filter((asset) => asset.browser_download_url)
    .slice(0, 8)
    .map((asset) => `[${truncate(asset.name || "Download", 80)}](${asset.browser_download_url})`)
    .join("\n");
  const embed = new EmbedBuilder()
    .setTitle(kind === "beta" ? `🧪 New Beta • ${truncate(tag, 180)}` : `🚀 New Release • ${truncate(tag, 180)}`)
    .setDescription(truncate(release.body || (kind === "beta"
      ? "This beta has passed its publication gates and is ready for testers."
      : "This version has passed its publication gates and is released."), 3900))
    .setColor(kind === "beta" ? 0xf1b94f : 0x4bd89c)
    .addFields(
      { name: "Channel", value: kind === "beta" ? "Beta / prerelease" : "Stable release", inline: true },
      { name: "Tag", value: `\`${truncate(tag, 120)}\``, inline: true },
      { name: "Downloads", value: truncate(downloads || (release.html_url ? `[Open release page](${release.html_url})` : "No assets listed."), 1024), inline: false },
    )
    .setFooter({ text: `Nexus Sentinel • release:${release.id}` })
    .setTimestamp(release.published_at ? new Date(release.published_at) : new Date());
  if (release.html_url) embed.setURL(release.html_url);
  return embed;
}

export function startBuildFeed(client: Client) {
  const seen = new Set<string>();
  const startedAt = Date.now();
  let timer: NodeJS.Timeout | null = null;
  let channel: TextChannel | null = null;
  let initialized = false;
  let polling = false;

  async function ensureReadyChannel(): Promise<TextChannel> {
    if (channel) return channel;
    channel = await provisionBuildFeedChannel(client);
    if (!initialized) {
      await seedSeenKeys(channel, seen);
      initialized = true;
    }
    return channel;
  }

  async function pollBuilds(target: TextChannel): Promise<void> {
    const payload = await githubGet<{ workflow_runs?: GithubRun[] }>("/actions/runs?per_page=50");
    const groups = groupRuns(payload.workflow_runs || []);
    const recoveryCutoff = startedAt - INITIAL_RECOVERY_WINDOW_MS;
    let posted = false;

    for (const group of groups) {
      const key = `build:${group.sha}`;
      if (seen.has(key)) continue;
      const updated = new Date(group.updatedAt).getTime();
      if (!Number.isFinite(updated) || updated < recoveryCutoff) {
        seen.add(key);
        continue;
      }
      const allPassed = group.runs.length > 0 && group.runs.every((run) => run.status === "completed" && run.conclusion === "success");
      if (!allPassed) continue;

      const artifacts: Array<GithubArtifact & { runId: number }> = [];
      for (const run of group.runs) {
        const runArtifacts = await artifactsForRun(run);
        artifacts.push(...runArtifacts.map((artifact) => ({ ...artifact, runId: run.id })));
      }
      if (!artifacts.length) continue;

      await target.send({ embeds: [buildTestingEmbed(group, artifacts)], allowedMentions: { parse: [] } });
      seen.add(key);
      console.log(`[build-feed] testing notice posted sha=${shortSha(group.sha)} branch=${group.branch} artifacts=${artifacts.length}`);
      posted = true;
      break;
    }

    if (!posted) console.log("[build-feed] no new test candidate");
  }

  async function pollReleases(target: TextChannel): Promise<void> {
    const releases = await githubGet<GithubRelease[]>("/releases?per_page=20");
    const recoveryCutoff = startedAt - INITIAL_RECOVERY_WINDOW_MS;
    const ordered = releases.filter((release) => !release.draft).sort((a, b) =>
      new Date(a.published_at || 0).getTime() - new Date(b.published_at || 0).getTime()
    );
    for (const release of ordered) {
      const key = `release:${release.id}`;
      if (seen.has(key)) continue;
      const published = new Date(release.published_at || 0).getTime();
      if (!Number.isFinite(published) || published < recoveryCutoff) {
        seen.add(key);
        continue;
      }
      await target.send({ embeds: [buildReleaseEmbed(release)], allowedMentions: { parse: [] } });
      seen.add(key);
      console.log(`[build-feed] ${releaseKind(release)} notice posted tag=${release.tag_name || release.name || release.id}`);
    }
  }

  async function poll(): Promise<void> {
    if (polling || !client.isReady()) return;
    polling = true;
    try {
      const target = await ensureReadyChannel();
      await pollBuilds(target);
      await pollReleases(target);
    } catch (error) {
      channel = null;
      console.error("[build-feed] poll failed:", error);
    } finally {
      polling = false;
    }
  }

  function begin() {
    if (timer) return;
    void poll();
    timer = setInterval(() => void poll(), checkIntervalMs());
    timer.unref?.();
  }

  client.once(Events.ClientReady, begin);
  client.on(Events.GuildCreate, () => {
    channel = null;
    void poll();
  });
  if (client.isReady()) begin();

  return {
    close() {
      if (timer) clearInterval(timer);
      timer = null;
    },
    poll,
  };
}

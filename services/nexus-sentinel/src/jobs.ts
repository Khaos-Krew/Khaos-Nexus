import { invokeEdgeFunction } from "./supabase.js";

export type Job = {
  name: string;
  intervalSeconds: number;
  enabled: boolean;
  run: () => Promise<void>;
  note?: string;
};

function secs(envName: string, fallback: number): number {
  const raw = process.env[envName];
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function flag(envName: string, fallback = false): boolean {
  const raw = process.env[envName];
  if (raw === undefined || raw.trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(raw.trim());
}

// The archived worker depended on website-era Supabase Edge Functions that are
// no longer part of the current Khaos Nexus backend. Keep the compatibility
// scheduler available for deliberate migrations, but never enable it by default.
const LEGACY_EDGE_JOBS_ENABLED = flag("ENABLE_LEGACY_EDGE_JOBS", false);

async function runEdge(fnName: string, opts: { useCronSecret?: boolean; body?: unknown } = {}): Promise<void> {
  const started = Date.now();
  const result = await invokeEdgeFunction(fnName, opts);
  const ms = Date.now() - started;
  if (result.ok) console.log(`[job] ${fnName} ok status=${result.status} ${ms}ms`);
  else console.error(`[job] ${fnName} FAIL status=${result.status} ${ms}ms body=${result.text.slice(0, 300)}`);
}

export const jobs: Job[] = [
  {
    name: "module-embed-refresh",
    intervalSeconds: secs("WARFRAME_EMBED_REFRESH_SECONDS", 300),
    enabled: LEGACY_EDGE_JOBS_ENABLED,
    note: "Legacy compatibility: module-embeds-cron.",
    run: () => runEdge("module-embeds-cron", { useCronSecret: true }),
  },
  {
    name: "server-status-refresh",
    intervalSeconds: secs("SERVER_STATUS_REFRESH_SECONDS", 300),
    enabled: LEGACY_EDGE_JOBS_ENABLED,
    note: "Legacy compatibility: discord-status-cron.",
    run: () => runEdge("discord-status-cron", { useCronSecret: true }),
  },
  {
    name: "patch-notes-check",
    intervalSeconds: secs("PATCH_NOTES_CHECK_SECONDS", 300),
    enabled: LEGACY_EDGE_JOBS_ENABLED,
    note: "Legacy compatibility: cron-patch-notes-discord.",
    run: () => runEdge("cron-patch-notes-discord", { useCronSecret: true }),
  },
  {
    name: "role-sync-check",
    intervalSeconds: secs("ROLE_SYNC_INTERVAL_SECONDS", 900),
    enabled: LEGACY_EDGE_JOBS_ENABLED,
    note: "Legacy compatibility: discord-role-sync-cron.",
    run: () => runEdge("discord-role-sync-cron", { useCronSecret: true }),
  },
  {
    name: "website-health-probe",
    intervalSeconds: secs("WEBSITE_HEALTH_INTERVAL_SECONDS", 300),
    enabled: LEGACY_EDGE_JOBS_ENABLED,
    note: "Legacy compatibility: website-health-probe.",
    run: () => runEdge("website-health-probe", { useCronSecret: true }),
  },
  {
    name: "community-rank-role-sync",
    intervalSeconds: secs("COMMUNITY_RANK_ROLE_SYNC_SECONDS", 900),
    enabled: LEGACY_EDGE_JOBS_ENABLED,
    note: "Legacy compatibility: community-rank-sync.",
    run: () => runEdge("community-rank-sync", { useCronSecret: true }),
  },
];

export function startJobScheduler() {
  if (!LEGACY_EDGE_JOBS_ENABLED) {
    console.log("[scheduler] legacy Supabase Edge Function jobs are disabled; set ENABLE_LEGACY_EDGE_JOBS=true only after their backend is restored.");
  }
  for (const job of jobs) {
    if (!job.enabled) {
      console.log(`[scheduler] ${job.name} DISABLED — ${job.note ?? ""}`);
      continue;
    }
    console.log(`[scheduler] ${job.name} every ${job.intervalSeconds}s — ${job.note ?? ""}`);
    const safeRun = async () => {
      try { await job.run(); } catch (err) { console.error(`[job] ${job.name} threw:`, err); }
    };
    setTimeout(safeRun, 10_000);
    setInterval(safeRun, job.intervalSeconds * 1000);
  }
}

export async function notifyGuildSync(guildIds: string[]): Promise<void> {
  if (!LEGACY_EDGE_JOBS_ENABLED || !guildIds.length) return;
  const result = await invokeEdgeFunction("community-bot-sync", {
    useCronSecret: true,
    body: { guild_ids: guildIds, source: "nexus-sentinel:gateway" },
  });
  if (result.ok) console.log(`[guildSync] ok status=${result.status} guilds=${guildIds.length}`);
  else console.error(`[guildSync] FAIL status=${result.status} body=${result.text.slice(0, 300)}`);
}

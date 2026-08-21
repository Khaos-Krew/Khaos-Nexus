import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import WebSocket from "ws";

if (typeof (globalThis as { WebSocket?: unknown }).WebSocket === "undefined") {
  (globalThis as { WebSocket: unknown }).WebSocket = WebSocket as unknown;
}

const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const CRON_SECRET = process.env.CRON_SECRET ?? "";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.warn("[supabase] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY missing — automation jobs will fail.");
}

export const admin: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

export async function invokeEdgeFunction(
  name: string,
  opts: { useCronSecret?: boolean; body?: unknown } = {},
): Promise<{ ok: boolean; status: number; text: string }> {
  if (!SUPABASE_URL) return { ok: false, status: 0, text: "SUPABASE_URL not set" };

  const token = opts.useCronSecret ? CRON_SECRET : SUPABASE_SERVICE_ROLE_KEY;
  if (!token) {
    return {
      ok: false,
      status: 0,
      text: opts.useCronSecret ? "CRON_SECRET not set" : "SUPABASE_SERVICE_ROLE_KEY not set",
    };
  }

  const url = `${SUPABASE_URL}/functions/v1/${name}`;
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
  if (opts.useCronSecret) headers["x-cron-secret"] = token;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(opts.body ?? { source: "nexus-sentinel" }),
  });
  const text = await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, text };
}

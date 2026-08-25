import { ActivityType, type Client, type PresenceStatusData } from "discord.js";

function parseActivityType(value: string | undefined): ActivityType {
  switch ((value ?? "Watching").toLowerCase()) {
    case "playing": return ActivityType.Playing;
    case "listening": return ActivityType.Listening;
    case "competing": return ActivityType.Competing;
    case "streaming": return ActivityType.Streaming;
    case "custom": return ActivityType.Custom;
    case "watching":
    default: return ActivityType.Watching;
  }
}

function parseStatus(value: string | undefined): PresenceStatusData {
  const v = (value ?? "online").toLowerCase();
  if (v === "idle" || v === "dnd" || v === "invisible") return v;
  return "online";
}

export interface PresenceRequest {
  status: PresenceStatusData;
  text: string;
  type: ActivityType;
}

export function getRequestedPresence(): PresenceRequest {
  return {
    status: parseStatus(process.env.BOT_STATUS),
    text: process.env.BOT_ACTIVITY_TEXT ?? "Watching Khaos Nexus",
    type: parseActivityType(process.env.BOT_ACTIVITY_TYPE),
  };
}

export function applyPresence(client: Client): PresenceRequest {
  const req = getRequestedPresence();
  try {
    client.user?.setPresence({ status: req.status, activities: [{ name: req.text, type: req.type }] });
    console.log(`[presence] set status=${req.status} type=${ActivityType[req.type]} text="${req.text}"`);
  } catch (err) {
    console.error("[presence] failed to set presence:", err);
  }
  return req;
}

export function readCachedPresence(client: Client) {
  const presence = client.user?.presence;
  return {
    status: presence?.status ?? null,
    activities: (presence?.activities ?? []).map((a) => ({ name: a.name, type: ActivityType[a.type] })),
  };
}

export function verifyPresenceMatches(client: Client, requested: PresenceRequest): boolean {
  const cached = readCachedPresence(client);
  if (cached.status !== requested.status) return false;
  const want = { name: requested.text, type: ActivityType[requested.type] };
  return cached.activities.some((a) => a.name === want.name && a.type === want.type);
}

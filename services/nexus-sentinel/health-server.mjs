import { createServer } from "node:http";

const startedAt = Date.now();
const configuredPort = Number.parseInt(String(process.env.PORT ?? "3000"), 10);
const port = Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 3000;
const token = String(process.env.NEXUS_BOT_TOKEN ?? "").trim();

async function checkDiscordToken() {
  if (!token) return { ok: false, detail: "missing_token" };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4_000);
  try {
    const response = await fetch("https://discord.com/api/v10/users/@me", {
      headers: {
        Accept: "application/json",
        Authorization: `Bot ${token}`,
      },
      signal: controller.signal,
    });

    if (!response.ok) return { ok: false, detail: `discord_http_${response.status}` };
    return { ok: true, detail: "discord_api_ready" };
  } catch (error) {
    return {
      ok: false,
      detail: error?.name === "AbortError" ? "discord_timeout" : "discord_unreachable",
    };
  } finally {
    clearTimeout(timeout);
  }
}

const server = createServer(async (request, response) => {
  const path = String(request.url ?? "/").split("?", 1)[0];
  if (path !== "/health") {
    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ status: "not_found" }));
    return;
  }

  const discord = await checkDiscordToken();
  const payload = {
    status: discord.ok ? "ok" : "degraded",
    service: "nexus-sentinel",
    discord: discord.detail,
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
  };

  response.writeHead(discord.ok ? 200 : 503, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[health] Nexus Sentinel health endpoint listening on 0.0.0.0:${port}/health`);
});
server.unref();

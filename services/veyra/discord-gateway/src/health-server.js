import { createServer } from "node:http";

const startedAt = Date.now();
const configuredPort = Number.parseInt(String(process.env.PORT ?? "3000"), 10);
const port = Number.isFinite(configuredPort) && configuredPort > 0 ? configuredPort : 3000;
const tokenConfigured = Boolean(String(process.env.VEYRA_DISCORD_TOKEN ?? "").trim());

const server = createServer((request, response) => {
  const path = String(request.url ?? "/").split("?", 1)[0];
  if (path !== "/health") {
    response.writeHead(404, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ status: "not_found" }));
    return;
  }

  const payload = {
    status: tokenConfigured ? "ok" : "degraded",
    service: "veyra-discord-gateway",
    tokenConfigured,
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
  };

  response.writeHead(tokenConfigured ? 200 : 503, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`[health] Veyra Discord gateway health endpoint listening on 0.0.0.0:${port}/health`);
});
server.unref();

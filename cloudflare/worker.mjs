const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/health" || url.pathname === "/healthz") {
      return json({
        ok: true,
        service: "khaos-nexus-dev",
        runtime: "cloudflare-workers"
      });
    }

    return json({
      ok: true,
      service: "Khaos Nexus Edge",
      environment: "development",
      message: "Cloudflare edge runtime is online. Application routes are not exposed from this placeholder worker."
    });
  }
};

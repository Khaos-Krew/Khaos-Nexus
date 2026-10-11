async function checkService(url, token, fallbackSummary) {
  if (!url) {
    return {
      state: 'unknown',
      summary: fallbackSummary
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(url, {
      method: 'GET',
      headers,
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        state: 'offline',
        summary: `Health endpoint responded with HTTP ${response.status}.`
      };
    }

    let detail;
    try {
      const body = await response.json();
      detail = body.summary || body.message || body.status;
    } catch {
      // A successful non-JSON health endpoint is still considered online.
    }

    return {
      state: 'online',
      summary: detail ? String(detail) : 'Health endpoint responded successfully.'
    };
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === 'AbortError';
    return {
      state: 'offline',
      summary: timedOut ? 'Health check timed out.' : 'Health endpoint could not be reached.'
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function onRequestGet(context) {
  const now = new Date().toISOString();
  const envName = context.env.NEXUS_ENV || 'development';

  const [sentinel, gameServices] = await Promise.all([
    checkService(
      context.env.SENTINEL_HEALTH_URL,
      context.env.SENTINEL_HEALTH_TOKEN,
      'Sentinel live health endpoint is not configured for this preview yet.'
    ),
    checkService(
      context.env.GAME_SERVICES_HEALTH_URL,
      context.env.GAME_SERVICES_HEALTH_TOKEN,
      'Game-service health aggregation is staged for backend integration.'
    )
  ]);

  const body = {
    apiVersion: 'v1',
    environment: envName,
    generatedAt: now,
    services: [
      {
        id: 'nexus-web',
        name: 'Nexus Web',
        summary: 'Cloudflare Pages web control surface is responding.',
        state: 'online',
        checkedAt: now,
        version: '0.3-sidecar'
      },
      {
        id: 'nexus-api',
        name: 'Nexus API',
        summary: 'Same-origin API v1 foundation is online.',
        state: 'online',
        checkedAt: now,
        version: 'v1'
      },
      {
        id: 'sentinel',
        name: 'Nexus Sentinel',
        summary: sentinel.summary,
        state: sentinel.state,
        checkedAt: now
      },
      {
        id: 'game-services',
        name: 'Game Services',
        summary: gameServices.summary,
        state: gameServices.state,
        checkedAt: now
      }
    ]
  };

  return Response.json(body, {
    headers: {
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff'
    }
  });
}

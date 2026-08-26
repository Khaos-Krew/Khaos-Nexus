export async function onRequestGet(context) {
  const now = new Date().toISOString();
  const envName = context.env.NEXUS_ENV || 'development';

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
        version: '0.2-sidecar'
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
        summary: 'Sentinel live health adapter has not been connected to this preview yet.',
        state: 'unknown',
        checkedAt: now
      },
      {
        id: 'game-services',
        name: 'Game Services',
        summary: 'Game-module health aggregation is staged for backend integration.',
        state: 'unknown',
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

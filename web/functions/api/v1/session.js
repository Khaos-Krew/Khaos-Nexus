import { readCookie, verifySignedSession } from '../../_lib/session.js';

export async function onRequestGet(context) {
  const token = readCookie(context.request, 'nexus_session');
  const payload = await verifySignedSession(token, context.env.NEXUS_SESSION_SECRET);

  if (!payload?.user) {
    return Response.json(
      { authenticated: false, user: null },
      { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }
    );
  }

  return Response.json(
    {
      authenticated: true,
      user: payload.user,
      expiresAt: new Date(payload.exp * 1000).toISOString()
    },
    { headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } }
  );
}

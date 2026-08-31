import { oauthStateCookie } from '../../../../_lib/session.js';

export async function onRequestGet(context) {
  const clientId = context.env.DISCORD_CLIENT_ID;
  if (!clientId) {
    return Response.json(
      { code: 'auth_not_configured', message: 'Discord OAuth is not configured for this environment.' },
      { status: 503, headers: { 'Cache-Control': 'no-store' } }
    );
  }

  const url = new URL(context.request.url);
  const redirectUri = `${url.origin}/api/v1/auth/discord/callback`;
  const state = crypto.randomUUID();
  const authorize = new URL('https://discord.com/oauth2/authorize');
  authorize.searchParams.set('client_id', clientId);
  authorize.searchParams.set('response_type', 'code');
  authorize.searchParams.set('redirect_uri', redirectUri);
  authorize.searchParams.set('scope', 'identify');
  authorize.searchParams.set('state', state);
  authorize.searchParams.set('prompt', 'consent');

  return new Response(null, {
    status: 302,
    headers: {
      Location: authorize.toString(),
      'Set-Cookie': oauthStateCookie(state),
      'Cache-Control': 'no-store'
    }
  });
}

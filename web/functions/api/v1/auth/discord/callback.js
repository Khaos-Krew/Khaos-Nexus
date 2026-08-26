import {
  clearOauthStateCookie,
  createSignedSession,
  oauthStateCookie,
  readCookie,
  sessionCookie
} from '../../../../_lib/session.js';

function parseIds(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

export async function onRequestGet(context) {
  const requestUrl = new URL(context.request.url);
  const code = requestUrl.searchParams.get('code');
  const state = requestUrl.searchParams.get('state');
  const storedState = readCookie(context.request, 'nexus_oauth_state');

  if (!code || !state || !storedState || state !== storedState) {
    return new Response('Invalid OAuth state.', {
      status: 400,
      headers: { 'Set-Cookie': clearOauthStateCookie(), 'Cache-Control': 'no-store' }
    });
  }

  const clientId = context.env.DISCORD_CLIENT_ID;
  const clientSecret = context.env.DISCORD_CLIENT_SECRET;
  const sessionSecret = context.env.NEXUS_SESSION_SECRET;
  if (!clientId || !clientSecret || !sessionSecret) {
    return new Response('Discord OAuth is not fully configured.', {
      status: 503,
      headers: { 'Set-Cookie': clearOauthStateCookie(), 'Cache-Control': 'no-store' }
    });
  }

  const redirectUri = `${requestUrl.origin}/api/v1/auth/discord/callback`;
  const tokenBody = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
  });

  const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: tokenBody
  });

  if (!tokenResponse.ok) {
    return new Response('Discord token exchange failed.', {
      status: 502,
      headers: { 'Set-Cookie': clearOauthStateCookie(), 'Cache-Control': 'no-store' }
    });
  }

  const token = await tokenResponse.json();
  const userResponse = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${token.access_token}` }
  });

  if (!userResponse.ok) {
    return new Response('Discord identity lookup failed.', {
      status: 502,
      headers: { 'Set-Cookie': clearOauthStateCookie(), 'Cache-Control': 'no-store' }
    });
  }

  const discordUser = await userResponse.json();
  const ownerIds = parseIds(context.env.NEXUS_OWNER_DISCORD_IDS);
  const staffIds = parseIds(context.env.NEXUS_STAFF_DISCORD_IDS);
  const isOwner = ownerIds.has(discordUser.id);
  const isStaff = isOwner || staffIds.has(discordUser.id);

  if (!isStaff) {
    return new Response('This Nexus development panel is currently restricted to approved staff accounts.', {
      status: 403,
      headers: { 'Set-Cookie': clearOauthStateCookie(), 'Cache-Control': 'no-store' }
    });
  }

  const roles = isOwner ? ['owner', 'staff'] : ['staff'];
  const capabilities = ['nexus.web.access'];
  if (isStaff) capabilities.push('nexus.staff.access');
  if (isOwner) capabilities.push('nexus.admin', 'nexus.private.access');

  const avatarUrl = discordUser.avatar
    ? `https://cdn.discordapp.com/avatars/${discordUser.id}/${discordUser.avatar}.png?size=128`
    : undefined;
  const now = Math.floor(Date.now() / 1000);
  const expiresAt = now + 60 * 60 * 24 * 7;
  const payload = {
    sub: discordUser.id,
    exp: expiresAt,
    user: {
      id: discordUser.id,
      displayName: discordUser.global_name || discordUser.username,
      avatarUrl,
      roles,
      capabilities
    }
  };

  const signed = await createSignedSession(payload, sessionSecret);
  const headers = new Headers({ Location: '/', 'Cache-Control': 'no-store' });
  headers.append('Set-Cookie', sessionCookie(signed));
  headers.append('Set-Cookie', clearOauthStateCookie());

  return new Response(null, { status: 302, headers });
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function base64UrlEncodeBytes(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlEncodeText(value) {
  return base64UrlEncodeBytes(encoder.encode(value));
}

function base64UrlDecodeText(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return decoder.decode(bytes);
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

export async function createSignedSession(payload, secret) {
  const encoded = base64UrlEncodeText(JSON.stringify(payload));
  const signature = await hmac(secret, encoded);
  return `${encoded}.${signature}`;
}

export async function verifySignedSession(token, secret) {
  if (!token || !secret) return null;
  const [encoded, signature] = token.split('.');
  if (!encoded || !signature) return null;
  const expected = await hmac(secret, encoded);
  if (signature.length !== expected.length) return null;

  let mismatch = 0;
  for (let i = 0; i < signature.length; i += 1) {
    mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  if (mismatch !== 0) return null;

  try {
    const payload = JSON.parse(base64UrlDecodeText(encoded));
    if (!payload.exp || Date.now() >= payload.exp * 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export function readCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function sessionCookie(token, maxAge = 604800) {
  return `nexus_session=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return 'nexus_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
}

export function oauthStateCookie(state) {
  return `nexus_oauth_state=${encodeURIComponent(state)}; Path=/api/v1/auth/discord; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
}

export function clearOauthStateCookie() {
  return 'nexus_oauth_state=; Path=/api/v1/auth/discord; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
}

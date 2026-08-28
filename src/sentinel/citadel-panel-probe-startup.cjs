'use strict';

function safe(value, max = 180) {
  return String(value || '').replace(/[\r\n\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function extractForm(html) {
  const source = String(html || '');
  const formMatch = source.match(/<form\b[^>]*>([\s\S]*?)<\/form>/i);
  if (!formMatch) return { action: '', method: '', inputs: [], antiForgery: false };
  const open = formMatch[0].match(/^<form\b[^>]*>/i)?.[0] || '';
  const action = open.match(/\baction\s*=\s*["']([^"']*)["']/i)?.[1] || '';
  const method = open.match(/\bmethod\s*=\s*["']([^"']*)["']/i)?.[1] || '';
  const inputs = [];
  for (const match of formMatch[1].matchAll(/<input\b[^>]*>/gi)) {
    const tag = match[0];
    const name = tag.match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    const type = tag.match(/\btype\s*=\s*["']([^"']+)["']/i)?.[1] || 'text';
    if (name) inputs.push(`${safe(name, 80)}:${safe(type, 40)}`);
  }
  const antiForgery = inputs.some((item) => /requestverificationtoken|csrf|xsrf|antiforgery/i.test(item));
  return { action: safe(action, 240), method: safe(method, 20), inputs: [...new Set(inputs)].slice(0, 30), antiForgery };
}

const timer = setTimeout(() => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  timeout.unref?.();
  void fetch('https://gamecp.citadelservers.com/Login?ReturnUrl=%2F', {
    method: 'GET',
    redirect: 'follow',
    signal: controller.signal,
    headers: { 'user-agent': 'Khaos-Nexus-Sentinel/0.1 Citadel connectivity probe' }
  })
    .then(async (response) => {
      const text = (await response.text()).slice(0, 1024 * 1024);
      const form = extractForm(text);
      console.log(`[Nexus Sentinal] Citadel panel probe: status=${response.status} finalHost=${safe(new URL(response.url).host)} formAction=${form.action || '(same-page)'} method=${form.method || 'unknown'} antiForgery=${form.antiForgery} inputs=${form.inputs.join(',') || '(none)'}`);
    })
    .catch((error) => console.warn(`[Nexus Sentinal] Citadel panel probe failed: ${safe(error?.name || error?.message || error)}`))
    .finally(() => clearTimeout(timeout));
}, 5_000);
timer.unref?.();

module.exports = { extractForm };

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { backoffMs, classifyResponse } = require('../../../src/game-bots/vanguard/bungie/errors.cjs');
const { createLimiter } = require('../../../src/game-bots/vanguard/bungie/limiter.cjs');
const { createAlerter } = require('../../../src/game-bots/vanguard/bungie/alerts.cjs');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { allowed, createBungieClient } = require('../../../src/game-bots/vanguard/bungie/client.cjs');
const { createBungieRuntime } = require('../../../src/game-bots/vanguard/bungie/runtime.cjs');
const { bungieConfig } = require('../../../src/game-bots/vanguard/config.cjs');
const { d2CommandBuilder } = require('../../../src/game-bots/vanguard/commands/d2.cjs');
const { panelFooter } = require('../../../src/game-bots/vanguard/panels.cjs');

const KEY = 'test-key-do-not-log';

function jsonResponse(status, body, contentType = 'application/json') {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return {
    status,
    headers: { get: (name) => (String(name).toLowerCase() === 'content-type' ? contentType : '') },
    async text() { return text; }
  };
}

function clock(start = 1_000_000) {
  let time = start;
  return {
    now: () => time,
    sleep: async (ms) => { time += ms; },
    advance(ms) { time += ms; }
  };
}

test('platform errors map to retry, unavailable, auth, privacy, and not-found', () => {
  assert.equal(classifyResponse({ status: 200, json: { ErrorCode: 5 } }).kind, 'unavailable');
  assert.equal(classifyResponse({ status: 200, json: { ErrorCode: 5 } }).retry, false);
  assert.equal(classifyResponse({ status: 200, json: { ErrorCode: 31, ThrottleSeconds: 2 } }).retry, true);
  assert.equal(classifyResponse({ status: 200, json: { ErrorCode: 36 } }).kind, 'retry');
  assert.equal(classifyResponse({ status: 429, json: { ErrorCode: 36 } }).retry, true);
  assert.equal(classifyResponse({ status: 200, json: { ErrorCode: 1665 } }).kind, 'privacy');
  assert.equal(classifyResponse({ status: 200, json: { ErrorCode: 1601 } }).reason, 'no-account');
  assert.equal(classifyResponse({ status: 200, json: { ErrorCode: 2101 } }).kind, 'auth');
  assert.equal(classifyResponse({ status: 200, json: { ErrorCode: 2101 } }).alert, 'auth');
  const html = classifyResponse({ status: 403, contentType: 'text/html', bodyText: '<html>cloudflare</html>' });
  assert.equal(html.kind, 'unavailable');
  assert.equal(html.retry, false);
  assert.equal(classifyResponse({ status: 403, contentType: 'application/json', json: { ErrorCode: 1 } }).reason, 'http-403');
  assert.equal(classifyResponse({ status: 200, contentType: 'text/html', bodyText: '<!DOCTYPE html>' }).reason, 'html');
  assert.equal(classifyResponse({ status: 200, contentType: 'text/plain', bodyText: 'ok' }).reason, 'bad-body');
  assert.equal(classifyResponse({ status: 200, json: { ok: true } }).reason, 'bad-body');
  assert.equal(classifyResponse({ status: 200, json: { ErrorCode: 1 } }).reason, 'bad-body');
  assert.equal(classifyResponse({ status: 200, json: { ErrorCode: 1, Response: null } }).kind, 'ok');
  assert.equal(classifyResponse({ status: 503, json: { ErrorCode: 51, ThrottleSeconds: 300, Response: null } }).throttleSeconds, 60);
  assert.equal(backoffMs(0, () => 0.5), 1000);
  assert.equal(backoffMs(1, () => 0.5), 2000);
  assert.equal(backoffMs(2, () => 0.5), 4000);
  assert.equal(backoffMs(8, () => 0.5), 30000);
});

test('the limiter stays at or below the request cap and honors ThrottleSeconds', async () => {
  const timer = clock();
  const limiter = createLimiter({ rps: 5, now: timer.now, sleep: timer.sleep });
  const stamps = [];
  await Promise.all(Array.from({ length: 50 }, async () => {
    stamps.push(await limiter.acquire('milestones'));
  }));
  stamps.sort((left, right) => left - right);
  assert.equal(stamps.length, 50);
  for (const stamp of stamps) {
    const window = stamps.filter((item) => item >= stamp && item < stamp + 1000);
    assert.ok(window.length <= 5, `burst ${window.length} at ${stamp}`);
  }
  const paused = clock(5_000);
  const lanes = createLimiter({ rps: 5, now: paused.now, sleep: paused.sleep });
  await lanes.acquire('vendors');
  lanes.pause('vendors', 3);
  const next = await lanes.acquire('vendors');
  assert.ok(next - 5_000 >= 3000);

  const split = clock(10_000);
  const splitLimiter = createLimiter({ rps: 5, now: split.now, sleep: split.sleep });
  await splitLimiter.acquire('vendors');
  splitLimiter.pause('vendors', 30);
  const other = await splitLimiter.acquire('milestones');
  assert.ok(other - 10_000 < 1000, `other lane waited ${other - 10_000}`);
  const again = await splitLimiter.acquire('vendors');
  assert.ok(again - 10_000 >= 30_000);

  const capped = clock(0);
  const capLimiter = createLimiter({ rps: 10, now: capped.now, sleep: capped.sleep });
  await capLimiter.acquire('settings');
  capLimiter.pause('settings', 300);
  const after = await capLimiter.acquire('settings');
  assert.ok(after >= 60_000);
  assert.ok(after < 90_000);
});

test('xur defaults on, other bungie flags default off, and the rps cap is 10', () => {
  const defaults = bungieConfig({});
  assert.equal(defaults.xurPanel, true);
  assert.equal(defaults.resetPanel, false);
  assert.equal(defaults.playerLookup, false);
  assert.equal(defaults.clanPanel, false);
  assert.equal(defaults.rps, 5);
  assert.deepEqual(bungieConfig({ VANGUARD_CLAN_GROUP_IDS: '5453042,nope' }).clanGroupIds, ['5453042']);
  assert.equal(bungieConfig({ VANGUARD_BUNGIE_RPS: '99' }).rps, 10);
  assert.equal(bungieConfig({ VANGUARD_XUR_PANEL_ENABLED: 'false' }).xurPanel, false);
  const enabled = d2CommandBuilder({}).toJSON().options.map((option) => option.name);
  assert.ok(enabled.includes('xur'));
  const hidden = d2CommandBuilder({ VANGUARD_XUR_PANEL_ENABLED: 'false' }).toJSON().options.map((option) => option.name);
  assert.equal(hidden.includes('xur'), false);
  assert.equal(allowed('GET', '/Settings/'), true);
  assert.equal(allowed('POST', '/Destiny2/SearchDestinyPlayerByBungieName/-1/'), true);
  assert.equal(allowed('GET', '/AdminGroups/'), false);
  assert.equal(allowed('POST', '/GroupV2/5453042/'), false);
});

test('fixtures for 5, 31, 36, 1665, 2101, and an HTML 403 follow the client rules', async () => {
  const timer = clock();
  const seen = [];
  const logs = [];
  const alerts = [];
  const alerter = createAlerter({
    now: timer.now,
    send: async (text) => { alerts.push(text); }
  });
  const script = [
    jsonResponse(200, { ErrorCode: 31, ThrottleSeconds: 0 }),
    jsonResponse(200, { ErrorCode: 36, ThrottleSeconds: 1 }),
    jsonResponse(200, { ErrorCode: 1, Response: { ok: true }, ThrottleSeconds: 0 })
  ];
  let calls = 0;
  const client = createBungieClient({
    env: { BUNGIE_API_KEY: KEY, VANGUARD_BUNGIE_RPS: '5' },
    now: timer.now,
    sleep: timer.sleep,
    random: () => 0.5,
    log: (line) => logs.push(line),
    warn: (line) => logs.push(line),
    alert: (kind, text) => alerter.alert(kind, text),
    fetch: async (url, options) => {
      calls += 1;
      seen.push({
        url,
        key: options.headers['X-API-Key'],
        origin: options.headers.Origin,
        userAgent: options.headers['User-Agent']
      });
      const next = script.shift();
      return next || jsonResponse(200, { ErrorCode: 1, Response: {} });
    }
  });
  const recovered = await client.get('/Destiny2/Milestones/');
  assert.equal(recovered.ok, true);
  assert.equal(calls, 3);
  assert.equal(seen[0].key, KEY);
  assert.equal(seen[0].origin, undefined);
  assert.match(seen[0].userAgent, /NexusVanguard\//);
  assert.equal(alerts.length, 0);
  assert.equal(logs.some((line) => line.includes(KEY)), false);
  assert.match(logs.join('\n'), /endpoint=\/Destiny2\/Milestones\//);
});

test('system disabled, privacy, missing account, bad key, and HTML 403 do not retry or leak', async () => {
  const cases = [
    { name: 'disabled', response: jsonResponse(200, { ErrorCode: 5 }), kind: 'unavailable', fetches: 1, alert: 'Bungie system disabled' },
    { name: 'privacy', response: jsonResponse(200, { ErrorCode: 1665 }), kind: 'privacy', fetches: 1, alert: '' },
    { name: 'missing', response: jsonResponse(200, { ErrorCode: 1601 }), kind: 'not-found', fetches: 1, alert: '' },
    { name: 'auth', response: jsonResponse(200, { ErrorCode: 2101 }), kind: 'auth', fetches: 1, alert: 'API key invalid or misconfigured' },
    { name: 'html', response: jsonResponse(403, '<html>SECRET_HTML_BODY</html>', 'text/html; charset=UTF-8'), kind: 'unavailable', fetches: 1, alert: 'No workaround' }
  ];
  for (const item of cases) {
    const timer = clock();
    const logs = [];
    const alerts = [];
    let fetches = 0;
    const alerter = createAlerter({ now: timer.now, send: async (text) => alerts.push(text) });
    const client = createBungieClient({
      env: { BUNGIE_API_KEY: KEY },
      now: timer.now,
      sleep: timer.sleep,
      random: () => 0.5,
      log: (line) => logs.push(line),
      warn: (line) => logs.push(line),
      alert: (kind, text) => alerter.alert(kind, text),
      fetch: async () => {
        fetches += 1;
        return item.response;
      }
    });
    const first = await client.get('/Settings/');
    assert.equal(first.kind, item.kind, item.name);
    assert.equal(fetches, item.fetches, item.name);
    if (item.alert) assert.match(alerts.join('\n'), new RegExp(item.alert));
    else assert.equal(alerts.length, 0, item.name);
    const text = logs.join('\n');
    assert.match(text, /status=/);
    assert.match(text, /content-type=/);
    assert.equal(text.includes(KEY), false);
    assert.equal(text.includes('SECRET_HTML_BODY'), false);
    await client.get('/Settings/');
    if (item.name === 'html' || item.name === 'auth') {
      assert.equal(alerts.length, 1, item.name);
      if (item.name === 'html') assert.equal(fetches, 2);
      if (item.name === 'auth') assert.equal(fetches, 1);
    }
  }
});

test('staff alerts for an HTML 403 fire once per 30 minutes', async () => {
  const timer = clock();
  const alerts = [];
  const alerter = createAlerter({ now: timer.now, send: async (text) => alerts.push(text) });
  const client = createBungieClient({
    env: { BUNGIE_API_KEY: KEY },
    now: timer.now,
    sleep: timer.sleep,
    random: () => 0.5,
    log: () => {},
    warn: () => {},
    alert: (kind, text) => alerter.alert(kind, text),
    fetch: async () => jsonResponse(403, '<html>nope</html>', 'text/html')
  });
  await client.get('/Destiny2/Vendors/', { components: '400,402' });
  await client.get('/Destiny2/Vendors/', { components: '400,402' });
  assert.equal(alerts.length, 1);
  timer.advance(30 * 60 * 1000);
  await client.get('/Destiny2/Milestones/');
  assert.equal(alerts.length, 2);
  assert.match(alerts[0], /No workaround/);
});

test('identical in-flight GETs share one request and a forbidden path is not sent', async () => {
  let fetches = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const client = createBungieClient({
    env: { BUNGIE_API_KEY: KEY },
    sleep: async () => {},
    log: () => {},
    warn: () => {},
    fetch: async () => {
      fetches += 1;
      await gate;
      return jsonResponse(200, { ErrorCode: 1, Response: { shared: true } });
    }
  });
  const pending = Promise.all([
    client.get('/Destiny2/Manifest/'),
    client.get('/Destiny2/Manifest/')
  ]);
  release();
  const [left, right] = await pending;
  assert.equal(fetches, 1);
  assert.equal(left.ok, true);
  assert.equal(right.json.Response.shared, true);
  let blocked = 0;
  const closed = createBungieClient({
    env: { BUNGIE_API_KEY: KEY },
    fetch: async () => { blocked += 1; return jsonResponse(200, { ErrorCode: 1 }); }
  });
  const refused = await closed.get('/AdminGroups/');
  assert.equal(refused.reason, 'forbidden');
  assert.equal(blocked, 0);
  const wrote = await closed.post('/GroupV2/5453042/', { name: 'nope' });
  assert.equal(wrote.reason, 'forbidden');
  assert.equal(blocked, 0);
  const unset = createBungieClient({ env: {}, fetch: async () => { blocked += 1; return jsonResponse(200, {}); } });
  const missing = await unset.get('/Settings/');
  assert.equal(missing.kind, 'unconfigured');
  assert.equal(blocked, 0);
});

test('an HTML or 403 settings response fail-closes without a manifest download', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanguard-html-'));
  const urls = [];
  const logs = [];
  const alerts = [];
  const original = console.log;
  console.log = (line) => logs.push(String(line));
  try {
    const runtime = createBungieRuntime({
      env: {
        BUNGIE_API_KEY: KEY,
        VANGUARD_DATA_DIR: dir,
        VANGUARD_XUR_PANEL_ENABLED: 'true',
        VANGUARD_RESET_PANEL_ENABLED: 'true'
      },
      now: () => 50_000_000,
      sleep: async () => {},
      discord: { user: { id: '111111111111111111' }, channels: { fetch: async () => null } },
      panelStore: { read: () => ({}), update: async (fn) => fn({}) },
      channelsFor: () => ({ panels: '' }),
      log: (line) => logs.push(String(line)),
      fetch: async (url) => {
        urls.push(String(url));
        return {
          status: 403,
          headers: { get: () => 'text/html' },
          async text() { return '<html>SECRET_HTML_BODY</html>'; }
        };
      }
    });
    runtime.api = createBungieClient({
      env: { BUNGIE_API_KEY: KEY },
      now: () => 50_000_000,
      sleep: async () => {},
      random: () => 0.5,
      log: (line) => logs.push(String(line)),
      warn: () => {},
      alert: async (kind, text) => { alerts.push(text); },
      fetch: async (url) => {
        urls.push(String(url));
        return {
          status: 403,
          headers: { get: () => 'text/html' },
          async text() { return '<html>SECRET_HTML_BODY</html>'; }
        };
      }
    });
    await runtime.health.poll(runtime.api);
    const snapshot = runtime.health.read();
    assert.equal(snapshot.degraded, true);
    assert.equal(snapshot.status, 403);
    assert.equal(runtime.health.allows('manifest'), false);
    assert.equal(urls.some((url) => url.includes('/common/destiny2_content/')), false);
    assert.equal(urls.length, 1);
    assert.match(logs.join('\n'), /bungie \/Settings\/ status=403 content-type=text\/html/);
    assert.equal(logs.join('\n').includes(KEY), false);
    assert.equal(logs.join('\n').includes('SECRET_HTML_BODY'), false);
    assert.match(alerts.join('\n'), /No workaround/);
  } finally {
    console.log = original;
  }
});

test('requests send BUNGIE_USER_AGENT and a configured value replaces the default', async () => {
  assert.match(bungieConfig({}).userAgent, /NexusVanguard\/0\.1\.0/);
  assert.match(bungieConfig({}).userAgent, /github\.com\/Khaos-Krew\/Khaos-Nexus/);
  let ua = '';
  const client = createBungieClient({
    env: { BUNGIE_API_KEY: KEY, BUNGIE_USER_AGENT: 'NexusVanguardTest/9' },
    sleep: async () => {},
    log: () => {},
    warn: () => {},
    fetch: async (_url, options) => {
      ua = options.headers['User-Agent'];
      return jsonResponse(200, { ErrorCode: 1, Response: {} });
    }
  });
  const result = await client.get('/Settings/');
  assert.equal(result.ok, true);
  assert.equal(ua, 'NexusVanguardTest/9');
});

test('a retry budget stops a throttled call before ThrottleSeconds is slept', async () => {
  const timer = clock(1_000_000);
  let calls = 0;
  const client = createBungieClient({
    env: { BUNGIE_API_KEY: KEY },
    now: timer.now,
    sleep: timer.sleep,
    random: () => 0.5,
    log: () => {},
    warn: () => {},
    fetch: async () => {
      calls += 1;
      return jsonResponse(503, { ErrorCode: 51, ThrottleSeconds: 300, Response: null });
    }
  });
  assert.equal(client.beginBudget(timer.now() + 60_000), true);
  const result = await client.get('/Settings/');
  client.endBudget();
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'budget');
  assert.equal(calls, 1);
  assert.equal(timer.now(), 1_000_000);
});

test('a non-JSON 200 keeps the last good panel and is not treated as success', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vanguard-bad-body-'));
  const guildId = '1516640233389822001';
  const channelId = '1516640233389822991';
  const messageId = '1516640233389822771';
  const botId = '111111111111111111';
  const lastGood = 'Nightfall: The Glassway\nRaid: Salvation';
  const edits = [];
  const footer = panelFooter('weekly-reset');
  const message = {
    id: messageId,
    author: { id: botId },
    embeds: [{ description: lastGood, footer: { text: footer } }],
    edit: async (body) => {
      edits.push(body);
      return message;
    }
  };
  let state = {
    [guildId]: {
      'weekly-reset': { channelId, messageId, lastHash: 'old', lastGood }
    }
  };
  try {
    const runtime = createBungieRuntime({
      env: {
        BUNGIE_API_KEY: KEY,
        VANGUARD_DATA_DIR: dir,
        VANGUARD_RESET_PANEL_ENABLED: 'true',
        VANGUARD_XUR_PANEL_ENABLED: 'false'
      },
      now: () => 50_000_000,
      sleep: async () => {},
      discord: {
        user: { id: botId },
        channels: {
          fetch: async () => ({
            id: channelId,
            send: async () => message,
            messages: {
              fetch: async (arg) => (arg && typeof arg === 'object' ? new Map([[message.id, message]]) : message)
            }
          })
        }
      },
      panelStore: {
        read: () => state,
        update: async (fn) => {
          state = fn(state);
          return state;
        }
      },
      channelsFor: () => ({ panels: channelId }),
      fetch: async (url) => {
        if (String(url).endsWith('/Settings/')) {
          return jsonResponse(200, { ErrorCode: 1, Response: { systems: { D2Milestones: { enabled: true } } } });
        }
        return {
          status: 200,
          headers: { get: () => 'text/plain' },
          async text() { return 'not-json'; }
        };
      }
    });
    await runtime.health.poll(runtime.api);
    const plain = await runtime.api.get('/Destiny2/Milestones/');
    assert.equal(plain.ok, false);
    assert.equal(plain.reason, 'bad-body');
    const schemaLess = createBungieClient({
      env: { BUNGIE_API_KEY: KEY },
      sleep: async () => {},
      log: () => {},
      warn: () => {},
      fetch: async () => jsonResponse(200, { ok: true })
    });
    const shapeless = await schemaLess.get('/Destiny2/Milestones/');
    assert.equal(shapeless.ok, false);
    assert.equal(shapeless.reason, 'bad-body');
    await runtime.refreshPanels(guildId, { which: 'reset', force: true });
    assert.equal(runtime.cache.get('milestones'), undefined);
    assert.equal(state[guildId]['weekly-reset'].lastGood, lastGood);
    assert.match(edits[0].embeds[0].description, /Nightfall: The Glassway/);
    assert.doesNotMatch(edits[0].embeds[0].description, /not found/i);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

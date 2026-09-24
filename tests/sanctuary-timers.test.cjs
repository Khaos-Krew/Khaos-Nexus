'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { MessageFlags } = require('discord.js');
const { handleSanctuaryInteraction } = require('../src/sentinel/sanctuary-bot.cjs');
const {
  DIABLO4_LIFE_TRACKERS_URL,
  TRACKER_USER_AGENT,
  TRACKER_CACHE_TTL_MS,
  buildSanctuaryTimerMessage,
  fetchCommunityTrackers,
  createTrackerCache
} = require('../src/sentinel/sanctuary-events.cjs');

const fixtureDir = path.join(__dirname, 'fixtures', 'sanctuary');
const bossFixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'diablo4-life-boss-helltide-empty.json'), 'utf8'));
const helltideFixture = JSON.parse(fs.readFileSync(path.join(fixtureDir, 'diablo4-life-helltide-present.json'), 'utf8'));
const NOW = Date.parse('2026-09-24T06:50:00.000Z');

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  };
}

function textResponse(body, status = 200) {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text
  };
}

function interaction(subcommand) {
  const replies = [];
  const target = {
    guildId: 'guild',
    channelId: 'channel',
    commandName: 'sanctuary',
    user: { id: '42' },
    deferred: false,
    replied: false,
    isChatInputCommand: () => true,
    isAutocomplete: () => false,
    isStringSelectMenu: () => false,
    isButton: () => false,
    options: { getSubcommand: () => subcommand, getString: () => null, getBoolean: () => false, getChannel: () => null },
    deferReply: async (payload = {}) => {
      target.deferred = true;
      replies.push(payload);
      return payload;
    },
    reply: async (payload) => {
      target.replied = true;
      replies.push(payload);
      return payload;
    },
    editReply: async (payload) => {
      replies.push(payload);
      return payload;
    },
    replies
  };
  return target;
}

test('live tracker shows the world boss and an empty helltide report', async () => {
  let calls = 0;
  let seen = null;
  const fetchImpl = async (url, options) => {
    calls += 1;
    seen = { url, options };
    return jsonResponse(bossFixture);
  };
  const message = await buildSanctuaryTimerMessage({
    now: NOW,
    env: {},
    fetchImpl,
    cache: createTrackerCache()
  });
  const embed = message.embeds[0];
  assert.equal(calls, 1);
  assert.equal(seen.url, DIABLO4_LIFE_TRACKERS_URL);
  assert.equal(seen.options.headers['user-agent'], TRACKER_USER_AGENT);
  assert.equal(seen.options.redirect, 'error');
  assert.ok(seen.options.signal);
  assert.equal(embed.title, 'Sanctuary event timers');
  assert.match(embed.description, /Live community trackers from diablo4\.life/);
  assert.match(embed.description, /not a Blizzard feed/);
  assert.match(embed.description, /Avarice, the Gold Cursed/);
  assert.equal(embed.description.match(/Avarice, the Gold Cursed/g).length, 1);
  assert.match(embed.description, /<t:1790244000:R>/);
  assert.match(embed.description, /<t:1790244000:F>/);
  assert.match(embed.description, /No community Helltide report right now/);
  assert.match(embed.description, /Approximate:/);
  assert.match(embed.description, /Legion is not wired to the live feed yet/);
  assert.match(embed.description, /does not count one down/);
  assert.doesNotMatch(embed.description, /Community tracker did not answer/);
  assert.match(embed.footer.text, /community data from diablo4\.life/);
  assert.match(embed.footer.text, /not Blizzard-official/);
  assert.match(embed.footer.text, /fetched 2026-09-24T06:50:00\.000Z/);
  assert.deepEqual(message.allowedMentions, { parse: [] });
});

test('live tracker shows a reported helltide and the next world boss', async () => {
  const message = await buildSanctuaryTimerMessage({
    now: NOW,
    env: {},
    fetchImpl: async () => textResponse(helltideFixture),
    cache: createTrackerCache()
  });
  const description = message.embeds[0].description;
  assert.match(description, /Ashava the Pestilent at Scosglen/);
  assert.match(description, /<t:1790251200:R>/);
  assert.match(description, /Wandering Death, Death Given Life/);
  assert.match(description, /<t:1790263800:R>/);
  assert.match(description, /the Helltide Rises at Kehjistan/);
  assert.match(description, /<t:1790240400:R>/);
  assert.match(description, /<t:1790240400:F>/);
  assert.doesNotMatch(description, /No community Helltide report right now/);
  assert.match(description, /Legion is not wired to the live feed yet/);
});

test('tracker cache serves a fresh payload and refetches after the ttl', async () => {
  assert.equal(TRACKER_CACHE_TTL_MS, 5 * 60 * 1000);
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return jsonResponse(bossFixture);
  };
  const cache = createTrackerCache();
  const first = await fetchCommunityTrackers({ fetchImpl, cache, now: NOW });
  const second = await fetchCommunityTrackers({ fetchImpl, cache, now: NOW + TRACKER_CACHE_TTL_MS - 1 });
  assert.equal(calls, 1);
  assert.equal(first.source, 'network');
  assert.equal(second.source, 'cache');
  assert.equal(second.payload.worldBoss.name, 'Avarice, the Gold Cursed');
  const third = await fetchCommunityTrackers({ fetchImpl, cache, now: NOW + TRACKER_CACHE_TTL_MS });
  assert.equal(calls, 2);
  assert.equal(third.source, 'network');
});

test('in-flight tracker reads share one request', async () => {
  let calls = 0;
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const fetchImpl = async () => {
    calls += 1;
    await gate;
    return jsonResponse(bossFixture);
  };
  const cache = createTrackerCache();
  const pending = Promise.all([
    fetchCommunityTrackers({ fetchImpl, cache, now: NOW }),
    fetchCommunityTrackers({ fetchImpl, cache, now: NOW })
  ]);
  release();
  const [left, right] = await pending;
  assert.equal(calls, 1);
  assert.equal(left.payload, right.payload);
});

test('a failed tracker read is not cached', async () => {
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    if (calls === 1) throw new Error('down');
    return jsonResponse(bossFixture);
  };
  const cache = createTrackerCache();
  const failed = await fetchCommunityTrackers({ fetchImpl, cache, now: NOW });
  const recovered = await fetchCommunityTrackers({ fetchImpl, cache, now: NOW });
  assert.equal(failed.ok, false);
  assert.equal(recovered.ok, true);
  assert.equal(recovered.source, 'network');
  assert.equal(calls, 2);
});

test('upstream failure, non-200, timeout, and bad json stay soft', async () => {
  const failures = [
    async () => { throw new Error('socket hang up'); },
    async () => ({ ok: false, status: 503, json: async () => ({}) }),
    async (url, options) => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      if (options.signal?.aborted) throw options.signal.reason || new Error('aborted');
      throw new Error('signal did not abort');
    },
    async () => ({ ok: true, status: 200, json: async () => { throw new Error('bad json'); } }),
    async () => ({ ok: true, status: 200, text: async () => '' }),
    async () => ({ ok: true, status: 200, json: async () => [] })
  ];
  for (const fetchImpl of failures) {
    const message = await buildSanctuaryTimerMessage({
      now: NOW,
      env: {},
      fetchImpl,
      cache: createTrackerCache(),
      timeoutMs: 20
    });
    const embed = message.embeds[0];
    assert.match(embed.description, /Community tracker did not answer/);
    assert.match(embed.description, /approximate, not a live report/);
    assert.match(embed.description, /Approximate community schedule/);
    assert.match(embed.description, /\*\*Helltide\*\*/);
    assert.match(embed.description, /\*\*World boss\*\*/);
    assert.match(embed.description, /does not count one down/);
    assert.match(embed.footer.text, /diablo4\.life unavailable/);
    assert.match(embed.footer.text, /not Blizzard-official/);
    assert.match(embed.footer.text, /fetched 2026-09-24T06:50:00\.000Z/);
    assert.doesNotMatch(embed.description, /Avarice/);
  }
});

test('sanctuary events command renders the fixture without a live request', async () => {
  const called = [];
  const originalFetch = global.fetch;
  global.fetch = () => { throw new Error('global fetch must stay unused'); };
  const command = interaction('events');
  try {
    const handled = await handleSanctuaryInteraction(command, {
      env: {},
      schedule: false,
      trackerCache: createTrackerCache(),
      trackerFetch: async (url, options) => {
        called.push({ url, agent: options.headers['user-agent'] });
        return textResponse(bossFixture);
      }
    });
    assert.equal(handled, true);
  } finally {
    global.fetch = originalFetch;
  }
  assert.deepEqual(called, [{ url: DIABLO4_LIFE_TRACKERS_URL, agent: TRACKER_USER_AGENT }]);
  assert.equal(command.replies[0].flags, MessageFlags.Ephemeral);
  const embed = command.replies.find((item) => item.embeds).embeds[0];
  assert.match(embed.description, /Avarice, the Gold Cursed/);
  assert.match(embed.description, /No community Helltide report right now/);
  assert.match(embed.footer.text, /community data from diablo4\.life/);
  assert.match(embed.footer.text, /not Blizzard-official/);
});

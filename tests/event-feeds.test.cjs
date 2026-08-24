'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { absoluteUnix, renderTemporal } = require('../src/sentinel/discord-time.cjs');
const { formatActionResult } = require('../src/sentinel/action-formatters.cjs');
const { parseNewsIndex, parseArticle, attachOfficialPokemonGoEvents } = require('../src/backend/providers/pokemon-go-official-events.cjs');
const { PokemonGoProvider } = require('../src/backend/providers/pokemon-go-provider.cjs');
const { pokemonGoEventPayload } = require('../src/sentinel/pokemon-go-event-ui.cjs');
const {
  FEED_RENDER_VERSION,
  EventFeedPublisher,
  feedMarker,
  feedPayload,
  messageMatchesFeed,
  setupChannelId
} = require('../src/sentinel/event-feed.cjs');

const FIXED = '2026-08-23T18:00:00Z';

test('fixed instants render with Discord local timestamps', () => {
  const unix = Math.floor(Date.parse(FIXED) / 1000);
  assert.equal(absoluteUnix(FIXED, 'startsAt'), unix);
  assert.equal(renderTemporal(FIXED, 'startsAt'), `<t:${unix}:F> • <t:${unix}:R>`);
});

test('local-time event announcements are not converted to one incorrect global instant', () => {
  const value = 'Sunday, August 16, 2026, from 2:00 p.m. to 5:00 p.m. local time';
  assert.equal(absoluteUnix(value, 'startsAt'), null);
  assert.equal(renderTemporal(value, 'startsAt'), value);
});

test('generic module formatting converts absolute dates and keeps source links secondary', () => {
  const payload = formatActionResult('division2', 'news', { ok:true, data:{
    publishedAt:FIXED,
    url:'https://example.com/update',
    headlines:[{ title:'Update', timestamp:FIXED, url:'https://example.com/update' }]
  }});
  const serialized = JSON.stringify(payload);
  assert.match(serialized, /<t:\d+:F>/);
  assert.match(serialized, /Open link|Official source/);
});

test('official Pokémon GO parser discovers event articles and preserves local-time wording', () => {
  const index = '<a href="/news/communityday-august-2026-nickit"><span>August 2026 Community Day: Nickit</span></a>';
  const articles = parseNewsIndex(index);
  assert.equal(articles.length, 1);
  const article = parseArticle('<h1>August 2026 Community Day: Nickit</h1><p>Sunday, August 16, 2026, from 2:00 p.m. to 5:00 p.m. local time</p><p>Nickit will be featured during August Community Day!</p>', articles[0]);
  assert.equal(article.eventType, 'Community Day');
  assert.equal(article.timeMode, 'local');
  assert.match(article.scheduleText, /2:00 p\.m\./);
  assert.match(article.sourceUrl, /pokemongo\.com\/news/);
});

test('official Pokémon GO events merge with Nexus-managed events without requiring account credentials', async () => {
  const stateFile = `/tmp/nexus-pogo-events-${process.pid}-${Date.now()}.json`;
  const provider = new PokemonGoProvider({ stateFile });
  const enhanced = attachOfficialPokemonGoEvents(provider, { official:{ newsUrl:'https://pokemongo.com/news', list:async () => [{ id:'official-1', name:'Community Day', official:true }] } });
  await enhanced.invoke('event-add', { name:'Local meetup' }, { actorId:'100000000000000001', role:'owner' });
  const result = await enhanced.invoke('events', {}, { actorId:'100000000000000001', role:'viewer' });
  assert.equal(result.events.some((item) => item.name === 'Local meetup'), true);
  assert.equal(result.events.some((item) => item.name === 'Community Day'), true);
  assert.equal(result.officialFeed, true);
  fs.rmSync(stateFile, { force:true });
});

test('Pokémon GO event UI produces a full post rather than a bare source URL', () => {
  const payload = pokemonGoEventPayload({ officialFeed:true, officialNewsUrl:'https://pokemongo.com/news', events:[{
    id:'official-1', name:'August Community Day: Nickit', eventType:'Community Day',
    scheduleText:'Sunday, August 16, 2026, from 2:00 p.m. to 5:00 p.m. local time', timeMode:'local',
    notes:'Nickit will be featured.', sourceUrl:'https://pokemongo.com/news/communityday-august-2026-nickit'
  }] });
  assert.match(payload.embeds[0].title, /Events & Community Days/);
  assert.match(payload.embeds[0].fields[0].value, /Nickit will be featured/);
  assert.match(payload.embeds[0].fields[0].value, /Local-time event/);
  assert.equal(payload.components[0].components[0].style, 5);
});

test('feed routing prefers a module-specific feed channel and produces one bounded marked post per action', () => {
  const setup = { consoleChannelId:'1', textChannels:[{name:'warframe-world-state',id:'2'}] };
  assert.equal(setupChannelId(setup, 'warframe-world-state'), '2');
  const payload = feedPayload('warframe', 'news', { ok:true, data:{ news:[{title:'One',date:FIXED}] } });
  assert.equal(payload.embeds.length, 1);
  assert.match(payload.content, /Nexus Sentinal Live Feed/);
  assert.match(payload.content, /news/);
  assert.equal(payload.embeds[0].footer.text, feedMarker('warframe', 'news'));
  assert.match(payload.embeds[0].title, /WARFRAME • NEWS/);
});

test('persistent Pokémon GO event feed uses the rich event card and managed marker', () => {
  const payload = feedPayload('pokemongo', 'events', { ok:true, data:{
    officialFeed:true,
    officialNewsUrl:'https://pokemongo.com/news',
    events:[{ name:'Community Day', eventType:'Community Day', notes:'Featured Pokémon.', sourceUrl:'https://pokemongo.com/news/test' }]
  }});
  assert.match(payload.embeds[0].title, /POKÉMON GO • EVENTS/);
  assert.match(payload.embeds[0].fields[0].value, /Featured Pokémon/);
  assert.equal(payload.embeds[0].footer.text, feedMarker('pokemongo', 'events'));
  assert.equal(payload.components[0].components[0].style, 5);
});

test('feed matching adopts both the old literal events label and the new Pokémon GO Events label', () => {
  const base = { author:{ id:'sentinal' }, embeds:[{ footer:{ text:'old footer' } }] };
  assert.equal(messageMatchesFeed({ ...base, content:'📡 **Nexus Sentinal Live Feed** • events\nUpdated before deploy' }, 'pokemongo', 'events', 'sentinal'), true);
  assert.equal(messageMatchesFeed({ ...base, content:'📡 **Nexus Sentinal Live Feed** • Pokémon GO Events\nUpdated after deploy' }, 'pokemongo', 'events', 'sentinal'), true);
});

test('feed matching does not adopt another bot message', () => {
  const message = {
    author:{ id:'other' },
    content:'📡 **Nexus Sentinal Live Feed** • news',
    embeds:[{ footer:{ text:feedMarker('warframe', 'news') } }]
  };
  assert.equal(messageMatchesFeed(message, 'warframe', 'news', 'sentinal'), false);
});

test('publisher recovers an existing live feed after state loss, edits it, and removes deploy duplicates', async () => {
  const edited = [];
  const deleted = [];
  const makeMessage = (id, createdTimestamp) => ({
    id,
    createdTimestamp,
    author:{ id:'sentinal', bot:true },
    content:'📡 **Nexus Sentinal Live Feed** • news\nUpdated recently',
    embeds:[{ title:'WARFRAME • NEWS', footer:{ text:'Nexus Sentinal • Backend-first game module' } }],
    edit:async (payload) => { edited.push({ id, payload }); },
    delete:async () => { deleted.push(id); }
  });
  const old = makeMessage('100000000000000001', 100);
  const newest = makeMessage('100000000000000002', 200);
  let sends = 0;
  const channel = {
    id:'200000000000000001',
    messages:{ fetch:async (input) => {
      if (typeof input === 'string') throw new Error('Unknown Message');
      return new Map([[old.id, old], [newest.id, newest]]);
    } },
    send:async () => { sends += 1; return { id:'new' }; }
  };
  const saved = new Map();
  const publisher = new EventFeedPublisher({
    client:{ user:{ id:'sentinal' } },
    guild:{},
    backend:{ invoke:async () => ({ ok:true, data:{ news:[{ title:'Current news' }] } }) },
    state:{},
    logger:{ log(){}, warn(){}, error(){} },
    feeds:[]
  });
  publisher.feedState = {
    get:(key) => saved.get(key) || null,
    set:(key, value) => { saved.set(key, value); return value; }
  };

  await publisher.publishAction({ moduleId:'warframe', channelName:'warframe-world-state' }, channel, 'news');
  assert.equal(sends, 0);
  assert.equal(edited.length, 1);
  assert.equal(edited[0].id, newest.id);
  assert.deepEqual(deleted, [old.id]);
  const state = saved.get('warframe:warframe-world-state:news');
  assert.equal(state.messageId, newest.id);
  assert.equal(state.renderVersion, FEED_RENDER_VERSION);
  assert.equal(edited[0].payload.embeds[0].footer.text, feedMarker('warframe', 'news'));
});

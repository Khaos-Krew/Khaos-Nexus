'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const POGO_ACTIONS = Object.freeze([
  'events','event-add','event-remove',
  'profile','profile-set','friends',
  'trades','trade-add','trade-remove','trade-matches',
  'raids','raid-create','raid-rsvp','raid-cancel',
  'vivillon',
  'collection','collection-add','collection-remove',
  'showcase','showcase-add',
  'meetups','meetup-create','meetup-rsvp',
  'counter','pvp','panel'
]);

const TYPES = ['normal','fire','water','electric','grass','ice','fighting','poison','ground','flying','psychic','bug','rock','ghost','dragon','dark','steel','fairy'];

const WEAK_TO = Object.freeze({
  normal:['fighting'],
  fire:['water','ground','rock'],
  water:['electric','grass'],
  electric:['ground'],
  grass:['fire','ice','poison','flying','bug'],
  ice:['fire','fighting','rock','steel'],
  fighting:['flying','psychic','fairy'],
  poison:['ground','psychic'],
  ground:['water','grass','ice'],
  flying:['electric','ice','rock'],
  psychic:['bug','ghost','dark'],
  bug:['fire','flying','rock'],
  rock:['water','grass','fighting','ground','steel'],
  ghost:['ghost','dark'],
  dragon:['ice','dragon','fairy'],
  dark:['fighting','bug','fairy'],
  steel:['fire','fighting','ground'],
  fairy:['poison','steel']
});

const ATTACKER_EXAMPLES = Object.freeze({
  fighting:['Lucario','Terrakion','Machamp'],
  water:['Kyogre','Primal Kyogre','Swampert'],
  ground:['Primal Groudon','Garchomp','Excadrill'],
  rock:['Mega Diancie','Rhyperior','Tyranitar'],
  electric:['Zekrom','Xurkitree','Magnezone'],
  grass:['Kartana','Mega Sceptile','Roserade'],
  fire:['Reshiram','Mega Blaziken','Darmanitan'],
  ice:['Mamoswine','Baxcalibur','Glaceon'],
  poison:['Mega Gengar','Nihilego','Roserade'],
  flying:['Rayquaza','Yveltal','Staraptor'],
  bug:['Mega Pinsir','Volcarona','Genesect'],
  psychic:['Mewtwo','Mega Alakazam','Metagross'],
  ghost:['Mega Gengar','Giratina (Origin)','Chandelure'],
  dark:['Mega Tyranitar','Hydreigon','Darkrai'],
  dragon:['Mega Rayquaza','Palkia','Salamence'],
  fairy:['Mega Gardevoir','Xerneas','Togekiss'],
  steel:['Metagross','Dialga','Excadrill']
});

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function text(value, max=120) { return String(value ?? '').replace(/[\r\n\t]+/g,' ').replace(/\s+/g,' ').trim().slice(0,max); }
function list(value, max=30) {
  if (Array.isArray(value)) return value.map(v=>text(v,80)).filter(Boolean).slice(0,max);
  return String(value ?? '').split(/[,\n]/).map(v=>text(v,80)).filter(Boolean).slice(0,max);
}
function nowIso() { return new Date().toISOString(); }
function id(prefix) { return `${prefix}-${crypto.randomBytes(4).toString('hex')}`; }

class PokemonGoProvider {
  constructor({ stateFile = path.join(process.cwd(),'data','pokemon-go-state.json') } = {}) {
    this.providerKind = 'pokemon-go-local';
    this.connected = true;
    this.supportedActions = [...POGO_ACTIONS];
    this.stateFile = stateFile;
    this.state = this.#load();
  }

  #blank() {
    return { version:1, profiles:{}, events:[], trades:[], raids:[], collection:{}, showcase:[], meetups:[] };
  }
  #load() {
    try {
      if (!fs.existsSync(this.stateFile)) return this.#blank();
      const parsed = JSON.parse(fs.readFileSync(this.stateFile,'utf8'));
      return { ...this.#blank(), ...parsed };
    } catch { return this.#blank(); }
  }
  #save() {
    fs.mkdirSync(path.dirname(this.stateFile), { recursive:true });
    const tmp = `${this.stateFile}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(this.state,null,2));
    fs.renameSync(tmp, this.stateFile);
  }
  #actor(context={}) {
    const actor = text(context.actorId, 40);
    if (!actor) throw new Error('This Pokémon GO action requires a Discord user identity.');
    return actor;
  }
  #profile(actor) { return this.state.profiles[actor] || null; }

  async invoke(actionId, payload={}, context={}) {
    switch (actionId) {
      case 'events': return this.events();
      case 'event-add': return this.eventAdd(payload, context);
      case 'event-remove': return this.eventRemove(payload);
      case 'profile': return this.profile(payload, context);
      case 'profile-set': return this.profileSet(payload, context);
      case 'friends': return this.friends(payload);
      case 'trades': return this.trades(payload, context);
      case 'trade-add': return this.tradeAdd(payload, context);
      case 'trade-remove': return this.tradeRemove(payload, context);
      case 'trade-matches': return this.tradeMatches(context);
      case 'raids': return this.raids(payload);
      case 'raid-create': return this.raidCreate(payload, context);
      case 'raid-rsvp': return this.raidRsvp(payload, context);
      case 'raid-cancel': return this.raidCancel(payload, context);
      case 'vivillon': return this.vivillon(payload);
      case 'collection': return this.collection(payload, context);
      case 'collection-add': return this.collectionAdd(payload, context);
      case 'collection-remove': return this.collectionRemove(payload, context);
      case 'showcase': return this.showcase(payload);
      case 'showcase-add': return this.showcaseAdd(payload, context);
      case 'meetups': return this.meetups(payload);
      case 'meetup-create': return this.meetupCreate(payload, context);
      case 'meetup-rsvp': return this.meetupRsvp(payload, context);
      case 'counter': return this.counter(payload);
      case 'pvp': return this.pvp(payload);
      case 'panel': return this.panel();
      default: throw new Error(`Unsupported Pokémon GO action: ${actionId}`);
    }
  }

  events() {
    const active = this.state.events.filter(e => !e.endsAt || Date.parse(e.endsAt) >= Date.now()).sort((a,b)=>Date.parse(a.startsAt||0)-Date.parse(b.startsAt||0));
    return { events: clone(active), officialNewsUrl:'https://pokemongolive.com/news/' };
  }
  eventAdd(payload, context) {
    const name=text(payload.name || payload.input,80); if(!name) throw new Error('Event name is required.');
    const event={ id:id('event'), name, startsAt:text(payload.startsAt,40), endsAt:text(payload.endsAt,40), notes:text(payload.notes,300), createdBy:this.#actor(context), createdAt:nowIso() };
    this.state.events.push(event); this.#save(); return clone(event);
  }
  eventRemove(payload) {
    const eventId=text(payload.id || payload.input,30); const before=this.state.events.length;
    this.state.events=this.state.events.filter(e=>e.id!==eventId); if(before===this.state.events.length) throw new Error('Event not found.');
    this.#save(); return { removed:eventId };
  }

  profile(payload, context) {
    const actor=text(payload.discordId,40) || this.#actor(context);
    return { profile: clone(this.#profile(actor)) };
  }
  profileSet(payload, context) {
    const actor=this.#actor(context);
    const current=this.#profile(actor)||{};
    const profile={
      ...current, discordId:actor,
      trainerName:text(payload.trainerName || current.trainerName,32),
      team:text(payload.team || current.team,16).toLowerCase(),
      level:Math.max(0,Math.min(80,Number(payload.level ?? current.level ?? 0)||0)),
      friendCode:text(payload.friendCode || current.friendCode,16).replace(/\D/g,'').slice(0,12),
      raidStyle:text(payload.raidStyle || current.raidStyle,24).toLowerCase(),
      pvpLeagues:list(payload.pvpLeagues ?? current.pvpLeagues,3),
      favorite:text(payload.favorite || current.favorite,40),
      vivillonRegion:text(payload.vivillonRegion || current.vivillonRegion,32).toLowerCase(),
      tradeArea:text(payload.tradeArea || current.tradeArea,80),
      updatedAt:nowIso()
    };
    if(!profile.trainerName) throw new Error('Trainer name is required.');
    this.state.profiles[actor]=profile; this.#save(); return clone(profile);
  }
  friends(payload={}) {
    const region=text(payload.region,32).toLowerCase(), team=text(payload.team,16).toLowerCase(), raidStyle=text(payload.raidStyle,24).toLowerCase();
    const profiles=Object.values(this.state.profiles).filter(p => (!region || p.vivillonRegion===region) && (!team || p.team===team) && (!raidStyle || p.raidStyle===raidStyle));
    return { profiles:clone(profiles.slice(0,50)) };
  }

  trades(payload={}, context={}) {
    const actor=text(payload.discordId,40) || this.#actor(context);
    return { trades:clone(this.state.trades.filter(t=>t.discordId===actor)) };
  }
  tradeAdd(payload, context) {
    const actor=this.#actor(context), kind=text(payload.kind,10).toLowerCase();
    if(!['want','offer'].includes(kind)) throw new Error('Trade kind must be want or offer.');
    const pokemon=text(payload.pokemon || payload.input,80); if(!pokemon) throw new Error('Pokémon name is required.');
    const trade={ id:id('trade'), discordId:actor, kind, pokemon, shiny:Boolean(payload.shiny), lucky:Boolean(payload.lucky), notes:text(payload.notes,180), createdAt:nowIso() };
    this.state.trades.push(trade); this.#save(); return clone(trade);
  }
  tradeRemove(payload, context) {
    const actor=this.#actor(context), tradeId=text(payload.id || payload.input,30); const before=this.state.trades.length;
    this.state.trades=this.state.trades.filter(t=>!(t.id===tradeId && t.discordId===actor)); if(before===this.state.trades.length) throw new Error('Trade entry not found.');
    this.#save(); return { removed:tradeId };
  }
  tradeMatches(context) {
    const actor=this.#actor(context), mine=this.state.trades.filter(t=>t.discordId===actor), matches=[];
    for(const want of mine.filter(t=>t.kind==='want')) {
      for(const offer of this.state.trades.filter(t=>t.discordId!==actor && t.kind==='offer' && t.pokemon.toLowerCase()===want.pokemon.toLowerCase())) {
        const theirs=this.state.trades.filter(t=>t.discordId===offer.discordId && t.kind==='want');
        const reciprocal=mine.find(m=>m.kind==='offer' && theirs.some(w=>w.pokemon.toLowerCase()===m.pokemon.toLowerCase()));
        matches.push({ want:clone(want), offer:clone(offer), reciprocal:reciprocal?clone(reciprocal):null, trainer:clone(this.#profile(offer.discordId)) });
      }
    }
    return { matches:matches.slice(0,50) };
  }

  raids(payload={}) {
    const includeEnded=Boolean(payload.includeEnded);
    const raids=this.state.raids.filter(r=>includeEnded || (!r.cancelledAt && (!r.endsAt || Date.parse(r.endsAt)>=Date.now()-3600000)));
    return { raids:clone(raids.sort((a,b)=>Date.parse(a.startsAt||0)-Date.parse(b.startsAt||0)).slice(0,50)) };
  }
  raidCreate(payload, context) {
    const actor=this.#actor(context), boss=text(payload.boss || payload.input,80); if(!boss) throw new Error('Raid boss is required.');
    const raid={ id:id('raid'), boss, battleType:text(payload.battleType || 'raid',20).toLowerCase(), tier:text(payload.tier,20), location:text(payload.location,120), startsAt:text(payload.startsAt,40), endsAt:text(payload.endsAt,40), remoteAllowed:payload.remoteAllowed!==false, notes:text(payload.notes,220), createdBy:actor, createdAt:nowIso(), attendees:{ local:[actor], remote:[], maybe:[] } };
    this.state.raids.push(raid); this.#save(); return clone(raid);
  }
  raidRsvp(payload, context) {
    const actor=this.#actor(context), raid=this.state.raids.find(r=>r.id===text(payload.id || payload.raidId,30)); if(!raid) throw new Error('Raid not found.');
    const status=text(payload.status,12).toLowerCase(); if(!['local','remote','maybe','leave'].includes(status)) throw new Error('RSVP status must be local, remote, maybe, or leave.');
    for(const arr of Object.values(raid.attendees)) { const i=arr.indexOf(actor); if(i>=0) arr.splice(i,1); }
    if(status!=='leave') raid.attendees[status].push(actor);
    raid.updatedAt=nowIso(); this.#save(); return clone(raid);
  }
  raidCancel(payload, context) {
    const actor=this.#actor(context), raid=this.state.raids.find(r=>r.id===text(payload.id || payload.raidId,30)); if(!raid) throw new Error('Raid not found.');
    if(raid.createdBy!==actor && context.role!=='owner') throw new Error('Only the raid creator or Nexus owner can cancel this raid.');
    raid.cancelledAt=nowIso(); raid.cancelledBy=actor; this.#save(); return clone(raid);
  }

  vivillon(payload={}) {
    const region=text(payload.region || payload.input,32).toLowerCase(); if(!region) throw new Error('Vivillon region is required.');
    const profiles=Object.values(this.state.profiles).filter(p=>p.vivillonRegion===region && p.friendCode);
    return { region, profiles:clone(profiles.slice(0,50)) };
  }

  collection(payload, context) {
    const actor=text(payload.discordId,40) || this.#actor(context);
    return { collection:clone(this.state.collection[actor] || []) };
  }
  collectionAdd(payload, context) {
    const actor=this.#actor(context), pokemon=text(payload.pokemon || payload.input,80); if(!pokemon) throw new Error('Pokémon name is required.');
    const tags=list(payload.tags,12).map(x=>x.toLowerCase());
    const entries=this.state.collection[actor] ||= [];
    const entry={ id:id('mon'), pokemon, tags, notes:text(payload.notes,150), addedAt:nowIso() };
    entries.push(entry); this.#save(); return clone(entry);
  }
  collectionRemove(payload, context) {
    const actor=this.#actor(context), entryId=text(payload.id || payload.input,30), entries=this.state.collection[actor]||[], before=entries.length;
    this.state.collection[actor]=entries.filter(e=>e.id!==entryId); if(before===this.state.collection[actor].length) throw new Error('Collection entry not found.');
    this.#save(); return { removed:entryId };
  }

  showcase(payload={}) {
    const limit=Math.max(1,Math.min(25,Number(payload.limit)||10));
    return { entries:clone(this.state.showcase.slice().sort((a,b)=>Date.parse(b.createdAt)-Date.parse(a.createdAt)).slice(0,limit)) };
  }
  showcaseAdd(payload, context) {
    const actor=this.#actor(context), pokemon=text(payload.pokemon || payload.input,80); if(!pokemon) throw new Error('Pokémon name is required.');
    const entry={ id:id('catch'), discordId:actor, pokemon, category:text(payload.category || 'rare catch',32).toLowerCase(), notes:text(payload.notes,180), imageUrl:text(payload.imageUrl,300), createdAt:nowIso() };
    this.state.showcase.push(entry); this.#save(); return clone(entry);
  }

  meetups(payload={}) {
    return { meetups:clone(this.state.meetups.filter(m=>!m.cancelledAt && (!m.startsAt || Date.parse(m.startsAt)>=Date.now()-86400000)).slice(0,50)) };
  }
  meetupCreate(payload, context) {
    const actor=this.#actor(context), name=text(payload.name || payload.input,80); if(!name) throw new Error('Meetup name is required.');
    const meetup={ id:id('meet'), name, location:text(payload.location,120), startsAt:text(payload.startsAt,40), notes:text(payload.notes,220), campfireUrl:text(payload.campfireUrl,300), createdBy:actor, createdAt:nowIso(), attendees:[actor] };
    this.state.meetups.push(meetup); this.#save(); return clone(meetup);
  }
  meetupRsvp(payload, context) {
    const actor=this.#actor(context), meetup=this.state.meetups.find(m=>m.id===text(payload.id || payload.meetupId,30)); if(!meetup) throw new Error('Meetup not found.');
    const going=payload.going!==false; meetup.attendees=meetup.attendees.filter(x=>x!==actor); if(going) meetup.attendees.push(actor); meetup.updatedAt=nowIso();
    this.#save(); return clone(meetup);
  }

  counter(payload={}) {
    const boss=text(payload.boss || payload.input,80), types=list(payload.types || payload.type,2).map(t=>t.toLowerCase()).filter(t=>TYPES.includes(t));
    if(!types.length) return { boss, types:[], message:'Add the boss type or types for a reliable weakness calculation.', weaknesses:[], recommendations:[] };
    const score=new Map();
    for(const type of types) for(const weak of WEAK_TO[type]||[]) score.set(weak,(score.get(weak)||0)+1);
    const weaknesses=[...score.entries()].sort((a,b)=>b[1]-a[1]).map(([type,count])=>({type,doublePressure:count>1}));
    const recommendations=weaknesses.slice(0,6).map(w=>({ type:w.type, examples:ATTACKER_EXAMPLES[w.type]||[] }));
    return { boss, types, weaknesses, recommendations, note:'Recommendations are coordination guidance, not live game-account data. Verify current moves, weather and event bonuses in Pokémon GO.' };
  }
  pvp(payload={}) {
    const league=text(payload.league || 'great',16).toLowerCase();
    const entries=String(payload.team || payload.input || '').split(',').map(s=>s.trim()).filter(Boolean).slice(0,3).map(raw=>{
      const [name,...typeParts]=raw.split(':');
      const types=typeParts.join(':').split('/').map(t=>t.trim().toLowerCase()).filter(t=>TYPES.includes(t)).slice(0,2);
      const weaknesses=[...new Set(types.flatMap(t=>WEAK_TO[t]||[]))];
      return { name:text(name,40), types, weaknesses };
    });
    if(!entries.length) throw new Error('Use team format: Pokemon:type/type, Pokemon:type, Pokemon:type/type');
    const weaknessCount={}; for(const e of entries) for(const w of e.weaknesses) weaknessCount[w]=(weaknessCount[w]||0)+1;
    const shared=Object.entries(weaknessCount).filter(([,n])=>n>=2).sort((a,b)=>b[1]-a[1]).map(([type,count])=>({type,count}));
    return { league, team:entries, sharedWeaknesses:shared, assessment:shared.length ? `Watch for shared pressure from ${shared.map(x=>x.type).join(', ')}.` : 'No repeated type weaknesses detected from the supplied typings.' };
  }
  panel() {
    return {
      title:'Khaos Nexus • Pokémon GO',
      features:['Raids & Max Battles','Events','Trainer Profiles','Friend Codes','Trade Matcher','Vivillon Exchange','Counter Assistant','PvP Assistant','Collection Tracker','Catch Showcase','Meetups'],
      privacy:'No Pokémon GO password, session token, location spoofing, automated catching/spinning, or game-client automation.'
    };
  }
}

module.exports = { PokemonGoProvider, POGO_ACTIONS, TYPES, WEAK_TO };

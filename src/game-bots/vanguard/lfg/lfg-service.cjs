'use strict';

const crypto = require('node:crypto');
const { findActivity } = require('./activities-static.cjs');
const { lfgLimits, snowflake } = require('../config.cjs');

const CREATE_WINDOW_MS = 10_000;
const ACTION_WINDOW_MS = 5_000;

function snapshot(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanText(value, max) {
  return String(value || '')
    .replace(/@/g, '@\u200b')
    .replace(/[\r\n]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);
}

function newId(bucket) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const id = crypto.randomBytes(6).toString('hex');
    if (!bucket[id]) return id;
  }
  return crypto.randomBytes(8).toString('hex');
}

function bucketFor(state, guildId) {
  const key = String(guildId || '');
  if (!state[key] || typeof state[key] !== 'object' || Array.isArray(state[key])) state[key] = {};
  return state[key];
}

function resolveSlots(requested, activity) {
  if (requested === undefined || requested === null || requested === '') return activity.slots;
  const slots = Number(requested);
  if (!Number.isInteger(slots) || slots < 2 || slots > 12) return null;
  return slots;
}

function createLfgService({ store, env = process.env, now = () => Date.now() } = {}) {
  const limits = new Map();

  function tooFast(userId, action, windowMs) {
    const key = `${String(userId || '')}:${action}`;
    const current = now();
    const last = limits.get(key) || 0;
    if (current - last < windowMs) return true;
    limits.set(key, current);
    return false;
  }

  function readBucket(guildId) {
    const state = store.read();
    const bucket = state[String(guildId || '')];
    return bucket && typeof bucket === 'object' ? bucket : {};
  }

  return {
    limits: () => lfgLimits(env),
    listOpen(guildId) {
      return Object.values(readBucket(guildId))
        .filter((post) => post && post.status === 'open')
        .map(snapshot)
        .sort((left, right) => String(left.expiresAt).localeCompare(String(right.expiresAt)));
    },
    listForClose({ guildId, userId, staff = false } = {}) {
      const user = String(userId || '');
      return this.listOpen(guildId).filter((post) => staff || post.hostId === user);
    },
    get(guildId, postId) {
      const post = readBucket(guildId)[String(postId || '')];
      return post ? snapshot(post) : null;
    },
    async create(input = {}) {
      const activity = findActivity(input.activityKey);
      if (!activity) return { ok: false, reason: 'activity' };
      const slots = resolveSlots(input.slots, activity);
      if (!slots) return { ok: false, reason: 'slots' };
      const guildId = String(input.guildId || '');
      const hostId = String(input.hostId || '');
      if (!guildId || !hostId) return { ok: false, reason: 'missing' };
      if (tooFast(input.hostId, 'create', CREATE_WINDOW_MS)) return { ok: false, reason: 'rate' };
      const at = now();
      const ttlMin = lfgLimits(env).ttlMin;
      let created = null;
      let reason = '';
      await store.update((state) => {
        const bucket = bucketFor(state, guildId);
        const open = Object.values(bucket).filter((post) => post && post.status === 'open' && post.hostId === hostId);
        if (open.length >= lfgLimits(env).maxOpen) {
          reason = 'cap';
          return state;
        }
        const id = newId(bucket);
        created = {
          id,
          guildId,
          hostId,
          activityKey: activity.key,
          slots,
          members: [hostId],
          when: cleanText(input.when, 80),
          note: cleanText(input.note, 200),
          status: 'open',
          voiceId: '',
          voiceOffered: false,
          expiresAt: new Date(at + ttlMin * 60_000).toISOString(),
          channelId: snowflake(input.channelId),
          messageId: '',
          createdAt: new Date(at).toISOString()
        };
        bucket[id] = created;
        return state;
      });
      if (reason) return { ok: false, reason };
      return { ok: true, post: snapshot(created) };
    },
    async join({ guildId, postId, userId, lobbyId } = {}) {
      if (tooFast(userId, 'join', ACTION_WINDOW_MS)) return { ok: false, reason: 'rate' };
      return mutate(store, guildId, postId, now, (post) => {
        const user = String(userId || '');
        if (!user) return { ok: false, reason: 'missing' };
        if (post.members.includes(user)) return { ok: false, reason: 'joined' };
        if (post.members.length >= post.slots) return { ok: false, reason: 'full' };
        post.members.push(user);
        const justFilled = post.members.length >= post.slots;
        if (justFilled) {
          post.voiceOffered = true;
          const lobby = snowflake(lobbyId);
          if (lobby) post.voiceId = lobby;
        }
        return { ok: true, justFilled };
      });
    },
    async leave({ guildId, postId, userId } = {}) {
      if (tooFast(userId, 'leave', ACTION_WINDOW_MS)) return { ok: false, reason: 'rate' };
      return mutate(store, guildId, postId, now, (post) => {
        const user = String(userId || '');
        if (post.hostId === user) return { ok: false, reason: 'host' };
        if (!post.members.includes(user)) return { ok: false, reason: 'not-member' };
        post.members = post.members.filter((id) => id !== user);
        if (post.members.length < post.slots) post.voiceOffered = false;
        return { ok: true };
      });
    },
    async close({ guildId, postId, userId, staff = false } = {}) {
      if (tooFast(userId, 'close', ACTION_WINDOW_MS)) return { ok: false, reason: 'rate' };
      return mutate(store, guildId, postId, now, (post) => {
        const user = String(userId || '');
        if (post.hostId !== user && !staff) return { ok: false, reason: 'forbidden' };
        post.status = 'closed';
        post.closedBy = user;
        return { ok: true };
      });
    },
    async attachMessage(guildId, postId, { channelId, messageId } = {}) {
      let saved = null;
      await store.update((state) => {
        const post = bucketFor(state, guildId)[String(postId || '')];
        if (!post) return state;
        if (snowflake(channelId)) post.channelId = snowflake(channelId);
        const linked = snowflake(messageId);
        if (linked) post.messageId = linked;
        saved = snapshot(post);
        return state;
      });
      return saved;
    },
    async remove(guildId, postId) {
      await store.update((state) => {
        const bucket = state[String(guildId || '')];
        if (bucket) delete bucket[String(postId || '')];
        return state;
      });
    },
    async expireDue(nowMs = now()) {
      const expired = [];
      await store.update((state) => {
        for (const [guildKey, bucket] of Object.entries(state)) {
          if (!bucket || typeof bucket !== 'object' || Array.isArray(bucket)) continue;
          for (const post of Object.values(bucket)) {
            if (!post || post.status !== 'open') continue;
            if (Date.parse(post.expiresAt) > nowMs) continue;
            post.status = 'expired';
            post.guildId = String(post.guildId || guildKey);
            expired.push(snapshot(post));
          }
        }
        return state;
      });
      return expired;
    }
  };
}

async function mutate(store, guildId, postId, now, change) {
  const at = now();
  let result = { ok: false, reason: 'missing' };
  await store.update((state) => {
    const post = bucketFor(state, guildId)[String(postId || '')];
    if (!post) {
      result = { ok: false, reason: 'missing' };
      return state;
    }
    post.guildId = String(post.guildId || guildId);
    if (post.status !== 'open') {
      result = { ok: false, reason: 'inactive', post: snapshot(post) };
      return state;
    }
    if (Date.parse(post.expiresAt) <= at) {
      post.status = 'expired';
      result = { ok: false, reason: 'inactive', post: snapshot(post) };
      return state;
    }
    const outcome = change(post) || { ok: false, reason: 'missing' };
    result = { ...outcome, post: snapshot(post) };
    return state;
  });
  return result;
}

module.exports = {
  CREATE_WINDOW_MS,
  ACTION_WINDOW_MS,
  createLfgService,
  cleanText
};

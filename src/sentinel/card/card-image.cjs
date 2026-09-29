'use strict';

const crypto = require('node:crypto');
const path = require('node:path');
const { Worker } = require('node:worker_threads');
const { LAYOUT_VERSION } = require('./card-image-model.cjs');

const LIMIT = 2;
const CACHE_MAX = 32;
const RENDER_TIMEOUT_MS = 2000;
const AVATAR_TIMEOUT_MS = 1500;

const cache = new Map();
let active = 0;
const waiters = [];
let workers = [];
let workerCursor = 0;
let seq = 0;
const pending = new Map();
let inlineDraw = null;

function hashPayload(model, avatarKey) {
  return crypto.createHash('sha256').update(JSON.stringify({
    layoutVersion: LAYOUT_VERSION,
    model,
    avatarKey
  })).digest('hex');
}

function remember(key, png) {
  if (cache.has(key)) cache.delete(key);
  cache.set(key, png);
  while (cache.size > CACHE_MAX) {
    const oldest = cache.keys().next().value;
    cache.delete(oldest);
  }
}

function acquire() {
  if (active < LIMIT) {
    active += 1;
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    waiters.push(resolve);
  });
}

function release() {
  active -= 1;
  const next = waiters.shift();
  if (next) {
    active += 1;
    next();
  }
}

async function runLimited(work) {
  await acquire();
  try {
    return await work();
  } finally {
    release();
  }
}

function withTimeout(work, timeoutMs) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('render-timeout'));
    }, timeoutMs);
    Promise.resolve().then(work).then((value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    }, (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
  });
}

function failWorker(worker, error) {
  workers = workers.filter((item) => item !== worker);
  for (const [id, waiter] of pending) {
    if (waiter.worker !== worker) continue;
    pending.delete(id);
    waiter.reject(error instanceof Error ? error : new Error('render-failed'));
  }
}

function pickWorker() {
  if (workers.length < LIMIT) {
    const worker = new Worker(path.join(__dirname, 'card-image-worker.cjs'));
    worker.unref();
    worker.on('message', (message) => {
      const waiter = pending.get(message.id);
      if (!waiter || waiter.worker !== worker) return;
      pending.delete(message.id);
      if (message.ok) waiter.resolve(Buffer.from(message.png));
      else waiter.reject(new Error(message.error || 'render-failed'));
    });
    worker.on('error', (error) => failWorker(worker, error));
    worker.on('exit', (code) => {
      if (code !== 0) failWorker(worker, new Error('render-failed'));
      else workers = workers.filter((item) => item !== worker);
    });
    workers.push(worker);
    return worker;
  }
  const worker = workers[workerCursor % workers.length];
  workerCursor += 1;
  return worker;
}

function renderInWorker(model, avatar) {
  const worker = pickWorker();
  const id = seq + 1;
  seq = id;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, worker });
    try {
      worker.postMessage({ id, model, avatar: avatar ? Buffer.from(avatar) : null });
    } catch (error) {
      pending.delete(id);
      reject(error);
    }
  });
}

async function drawInline(model, avatar) {
  if (!inlineDraw) inlineDraw = require('./card-image-draw.cjs').drawCardPng;
  return inlineDraw(model, avatar);
}

let useInline = false;

async function dispatchRender(model, avatar) {
  if (useInline) return drawInline(model, avatar);
  try {
    return await renderInWorker(model, avatar);
  } catch (error) {
    const message = String(error?.message || error);
    if (workers.length === 0 && /Cannot find module|worker/i.test(message)) {
      useInline = true;
      return drawInline(model, avatar);
    }
    throw error;
  }
}

function discordAvatarUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:'
      && (parsed.hostname === 'cdn.discordapp.com' || parsed.hostname === 'media.discordapp.net');
  } catch {
    return false;
  }
}

async function fetchAvatar(url, timeoutMs, fetchImpl) {
  if (!discordAvatarUrl(url)) return null;
  const fetchFn = fetchImpl || globalThis.fetch;
  if (typeof fetchFn !== 'function') return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchFn(url, { signal: controller.signal });
    if (!response || response.ok !== true) return null;
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 32 || bytes.length > 1_500_000) return null;
    return bytes;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function renderCardPng(model, options = {}) {
  if (!model) throw new Error('empty-model');
  const avatar = await fetchAvatar(options.avatarUrl || null, options.avatarTimeoutMs || AVATAR_TIMEOUT_MS, options.fetch);
  const avatarKey = avatar ? crypto.createHash('sha256').update(avatar).digest('hex') : 'fallback';
  const key = hashPayload(model, avatarKey);
  if (cache.has(key)) {
    const hit = cache.get(key);
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const produce = typeof options.produce === 'function'
    ? () => options.produce(model, avatar)
    : () => dispatchRender(model, avatar);
  const png = await withTimeout(() => runLimited(produce), options.timeoutMs || RENDER_TIMEOUT_MS);
  if (!Buffer.isBuffer(png) || png.length < 8) throw new Error('empty-image');
  remember(key, png);
  return png;
}

function clearCardImageCache() {
  cache.clear();
}

async function closeCardImageWorkers() {
  const current = workers;
  workers = [];
  await Promise.all(current.map((worker) => worker.terminate()));
}

module.exports = {
  renderCardPng,
  clearCardImageCache,
  closeCardImageWorkers,
  fetchAvatar
};

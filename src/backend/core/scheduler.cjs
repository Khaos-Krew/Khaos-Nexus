'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { getModule } = require('../modules/catalog.cjs');

function cleanText(value, max = 1000) {
  return String(value ?? '').replace(/[\r\n\u0000]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function timeParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return {
    date: `${values.year}-${values.month}-${values.day}`,
    time: `${values.hour}:${values.minute}`
  };
}

function parseAddInput(payload = {}) {
  if (payload.mode === 'daily' && payload.time && payload.actionId) {
    return {
      mode: 'daily',
      time: cleanText(payload.time, 5),
      actionId: cleanText(payload.actionId, 60).toLowerCase(),
      payload: payload.payload && typeof payload.payload === 'object' ? payload.payload : {}
    };
  }
  const input = cleanText(payload.input, 1200);
  const match = /^daily\s+(\d{1,2}:\d{2})\s+([a-z0-9-]+)(?:\s+([\s\S]+))?$/i.exec(input);
  if (!match) throw new Error('Schedule syntax: daily HH:MM <action> [input]. Example: daily 06:00 restart');
  const [hourText, minuteText] = match[1].split(':');
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) {
    throw new Error('Schedule time must be a valid 24-hour HH:MM value.');
  }
  return {
    mode: 'daily',
    time: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    actionId: match[2].toLowerCase(),
    payload: match[3] ? { input: cleanText(match[3], 1000) } : {}
  };
}

class SharedScheduler {
  constructor(options = {}) {
    this.filePath = path.resolve(options.filePath || path.join(process.cwd(), 'data', 'schedules.json'));
    this.timeZone = cleanText(options.timeZone || 'America/Chicago', 80) || 'America/Chicago';
    this.tickMs = Math.max(15000, Number(options.tickMs || 30000));
    this.now = options.now || (() => new Date());
    this.execute = options.execute || null;
    this.timer = null;
    this.state = { schedules: [] };
    this.load();
  }

  load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      if (parsed && Array.isArray(parsed.schedules)) this.state = { schedules: parsed.schedules };
    } catch (error) {
      if (error?.code !== 'ENOENT') console.error('[Nexus Scheduler] state load:', error.message);
    }
  }

  save() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(this.state, null, 2)}\n`, { mode: 0o600 });
    fs.renameSync(temporary, this.filePath);
  }

  registerExecutor(execute) {
    if (typeof execute !== 'function') throw new Error('Scheduler executor must be a function.');
    this.execute = execute;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick().catch((error) => console.error('[Nexus Scheduler] tick:', error.message)), this.tickMs);
    this.timer.unref?.();
    this.tick().catch((error) => console.error('[Nexus Scheduler] initial tick:', error.message));
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  list(moduleId) {
    return this.state.schedules
      .filter((item) => !moduleId || item.moduleId === moduleId)
      .map(({ lastRunKey, ...item }) => ({ ...item }));
  }

  validateTarget(moduleId, actionId) {
    const module = getModule(moduleId);
    if (!module) throw new Error(`Unknown module: ${moduleId}`);
    const capability = module.capabilities.find((item) => item.id === actionId);
    if (!capability) throw new Error(`${module.name} does not expose ${actionId}.`);
    if (capability.service === 'scheduler' || actionId.startsWith('schedule-')) throw new Error('Scheduler actions cannot schedule other scheduler actions.');
    return capability;
  }

  add(moduleId, payload = {}, context = {}) {
    const parsed = parseAddInput(payload);
    this.validateTarget(moduleId, parsed.actionId);
    const item = {
      id: crypto.randomBytes(5).toString('hex'),
      moduleId,
      actionId: parsed.actionId,
      payload: parsed.payload,
      mode: parsed.mode,
      time: parsed.time,
      timeZone: cleanText(payload.timeZone || this.timeZone, 80) || this.timeZone,
      enabled: true,
      createdBy: cleanText(context.actorId || 'owner', 100),
      createdAt: new Date().toISOString(),
      lastRunKey: ''
    };
    this.state.schedules.push(item);
    this.save();
    return { schedule: { ...item, lastRunKey: undefined } };
  }

  remove(moduleId, payload = {}) {
    const id = cleanText(payload.id || payload.input, 80).toLowerCase();
    if (!id) throw new Error('Provide the schedule id to remove.');
    const index = this.state.schedules.findIndex((item) => item.moduleId === moduleId && item.id === id);
    if (index < 0) throw new Error(`Schedule ${id} was not found for ${moduleId}.`);
    const [removed] = this.state.schedules.splice(index, 1);
    this.save();
    return { removed: { id: removed.id, moduleId: removed.moduleId, actionId: removed.actionId, time: removed.time, timeZone: removed.timeZone } };
  }

  async invoke(moduleId, actionId, payload = {}, context = {}) {
    if (actionId === 'schedule-list') return { timeZone: this.timeZone, schedules: this.list(moduleId) };
    if (actionId === 'schedule-add') return this.add(moduleId, payload, context);
    if (actionId === 'schedule-remove') return this.remove(moduleId, payload);
    throw new Error(`Shared scheduler does not support ${actionId}.`);
  }

  async tick() {
    if (typeof this.execute !== 'function') return;
    const now = this.now();
    let dirty = false;
    for (const item of this.state.schedules) {
      if (!item.enabled || item.mode !== 'daily') continue;
      let local;
      try { local = timeParts(now, item.timeZone || this.timeZone); }
      catch (error) {
        console.error(`[Nexus Scheduler] ${item.id} timezone:`, error.message);
        continue;
      }
      const runKey = `${local.date}:${item.time}`;
      if (local.time !== item.time || item.lastRunKey === runKey) continue;
      item.lastRunKey = runKey;
      item.lastAttemptAt = new Date().toISOString();
      dirty = true;
      try {
        const result = await this.execute(item.moduleId, item.actionId, item.payload || {}, {
          role: 'owner', confirmed: true, actorId: `scheduler:${item.id}`
        });
        item.lastResult = result?.ok === true ? 'ok' : cleanText(result?.code || result?.message || 'failed', 120);
      } catch (error) {
        item.lastResult = cleanText(error?.message || error || 'failed', 120);
      }
    }
    if (dirty) this.save();
  }
}

module.exports = { SharedScheduler, cleanText, parseAddInput, timeParts };

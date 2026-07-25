'use strict';

const crypto = require('node:crypto');

const MAX_SCHEDULES = 50;
const MAX_HISTORY = 250;
const DEFAULT_WARNING_MINUTES = Object.freeze([30, 15, 10, 5, 1]);
const VALID_ACTIONS = new Set(['restart', 'save']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function cleanText(value, max, fallback = '') {
  const text = String(value ?? '').replace(/\u0000/g, '').trim();
  return (text || fallback).slice(0, max);
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : fallback;
}

function normalizeId(value, prefix = 'schedule') {
  const raw = String(value || '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/.test(raw) ? raw : `${prefix}-${crypto.randomUUID()}`;
}

function normalizeDays(values) {
  const source = Array.isArray(values) ? values : [];
  const result = [...new Set(source.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
  return result.length ? result : [0, 1, 2, 3, 4, 5, 6];
}

function normalizeWarnings(values) {
  const source = Array.isArray(values) ? values : String(values || '').split(',');
  const warnings = [...new Set(source.map(Number)
    .filter((value) => Number.isFinite(value) && value >= 1 && value <= 180)
    .map((value) => Math.round(value)))].sort((a, b) => b - a);
  return warnings.length ? warnings.slice(0, 12) : [...DEFAULT_WARNING_MINUTES];
}

function normalizeServerIds(values) {
  const source = Array.isArray(values) ? values : [];
  return [...new Set(source.map((value) => cleanText(value, 100)).filter(Boolean))].slice(0, 30);
}

function normalizeSchedule(input = {}) {
  const action = VALID_ACTIONS.has(input.action) ? input.action : 'restart';
  return {
    id: normalizeId(input.id, 'server-schedule'),
    name: cleanText(input.name, 100, action === 'save' ? 'Scheduled World Save' : 'Scheduled Server Restart'),
    serverIds: normalizeServerIds(input.serverIds),
    enabled: input.enabled !== false,
    action,
    daysOfWeek: normalizeDays(input.daysOfWeek),
    hour: Math.round(clamp(input.hour, 0, 23, 6)),
    minute: Math.round(clamp(input.minute, 0, 59, 0)),
    warningMinutes: normalizeWarnings(input.warningMinutes),
    warningMessage: cleanText(input.warningMessage, 500, 'Server restart in {minutes} minute(s). Please move to a safe location and prepare to disconnect.'),
    finalMessage: cleanText(input.finalMessage, 500, 'Server maintenance is beginning now. The world is being saved.'),
    saveBeforeAction: input.saveBeforeAction !== false,
    saveDelaySeconds: Math.round(clamp(input.saveDelaySeconds, 0, 120, 10)),
    restartTimeoutMinutes: Math.round(clamp(input.restartTimeoutMinutes, 2, 60, 15)),
    discordReport: input.discordReport !== false,
    lastRunAt: input.lastRunAt ? String(input.lastRunAt) : null,
    lastOutcome: ['success', 'partial', 'failed', 'cancelled', 'running'].includes(input.lastOutcome) ? input.lastOutcome : null,
    lastError: cleanText(input.lastError, 500)
  };
}

function normalizeSchedulerConfig(input = {}) {
  const settings = input.settings || {};
  const seen = new Set();
  const schedules = [];
  for (const source of Array.isArray(input.schedules) ? input.schedules : []) {
    const schedule = normalizeSchedule(source);
    if (seen.has(schedule.id)) continue;
    seen.add(schedule.id);
    schedules.push(schedule);
  }
  return {
    schemaVersion: 1,
    settings: {
      enabled: settings.enabled !== false,
      missedRunGraceMinutes: Math.round(clamp(settings.missedRunGraceMinutes, 1, 60, 10)),
      pollSeconds: Math.round(clamp(settings.pollSeconds, 10, 120, 30)),
      historyLimit: Math.round(clamp(settings.historyLimit, 25, MAX_HISTORY, 150))
    },
    schedules: schedules.slice(0, MAX_SCHEDULES)
  };
}

function localDateKey(dateInput) {
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const parts = [date.getFullYear(), String(date.getMonth() + 1).padStart(2, '0'), String(date.getDate()).padStart(2, '0')];
  return parts.join('-');
}

function occurrenceKey(scheduleInput, dateInput) {
  const schedule = normalizeSchedule(scheduleInput);
  const date = dateInput instanceof Date ? dateInput : new Date(dateInput);
  return `${schedule.id}:${localDateKey(date)}:${String(schedule.hour).padStart(2, '0')}${String(schedule.minute).padStart(2, '0')}`;
}

function targetOnDate(scheduleInput, dateInput) {
  const schedule = normalizeSchedule(scheduleInput);
  const date = dateInput instanceof Date ? new Date(dateInput.getTime()) : new Date(dateInput);
  date.setHours(schedule.hour, schedule.minute, 0, 0);
  return date;
}

function nextOccurrence(scheduleInput, fromInput = new Date()) {
  const schedule = normalizeSchedule(scheduleInput);
  const from = fromInput instanceof Date ? new Date(fromInput.getTime()) : new Date(fromInput);
  for (let offset = 0; offset <= 8; offset += 1) {
    const date = new Date(from.getTime());
    date.setDate(from.getDate() + offset);
    const target = targetOnDate(schedule, date);
    if (!schedule.daysOfWeek.includes(target.getDay())) continue;
    if (target.getTime() > from.getTime()) return target;
  }
  return null;
}

function relevantOccurrence(scheduleInput, nowInput = new Date(), graceMinutes = 10) {
  const schedule = normalizeSchedule(scheduleInput);
  const now = nowInput instanceof Date ? new Date(nowInput.getTime()) : new Date(nowInput);
  const largestWarning = schedule.action === 'restart' ? Math.max(...schedule.warningMinutes, 0) : 0;
  for (const offset of [-1, 0]) {
    const date = new Date(now.getTime());
    date.setDate(now.getDate() + offset);
    const target = targetOnDate(schedule, date);
    if (!schedule.daysOfWeek.includes(target.getDay())) continue;
    const startsAt = target.getTime() - largestWarning * 60 * 1000;
    const endsAt = target.getTime() + Math.max(1, Number(graceMinutes) || 10) * 60 * 1000;
    if (now.getTime() >= startsAt && now.getTime() <= endsAt) {
      return { key: occurrenceKey(schedule, target), target };
    }
  }
  return null;
}

function dueWarning(scheduleInput, occurrenceState = {}, nowInput = new Date(), targetInput) {
  const schedule = normalizeSchedule(scheduleInput);
  if (schedule.action !== 'restart') return null;
  const now = nowInput instanceof Date ? nowInput : new Date(nowInput);
  const target = targetInput instanceof Date ? targetInput : new Date(targetInput);
  if (now.getTime() >= target.getTime()) return null;
  const sent = new Set(Array.isArray(occurrenceState.warningsSent) ? occurrenceState.warningsSent.map(Number) : []);
  const due = schedule.warningMinutes.filter((minutes) => !sent.has(minutes) && now.getTime() >= target.getTime() - minutes * 60 * 1000);
  if (!due.length) return null;
  return Math.min(...due);
}

function warningText(scheduleInput, minutes) {
  const schedule = normalizeSchedule(scheduleInput);
  return schedule.warningMessage
    .replaceAll('{minutes}', String(minutes))
    .replaceAll('{server}', schedule.name)
    .slice(0, 500);
}

function normalizeHistoryEntry(input = {}) {
  return {
    id: normalizeId(input.id, 'scheduler-run'),
    scheduleId: cleanText(input.scheduleId, 100),
    scheduleName: cleanText(input.scheduleName, 100, 'Server schedule'),
    occurrenceKey: cleanText(input.occurrenceKey, 150),
    source: ['scheduled', 'manual'].includes(input.source) ? input.source : 'scheduled',
    action: VALID_ACTIONS.has(input.action) ? input.action : 'restart',
    serverIds: normalizeServerIds(input.serverIds),
    startedAt: input.startedAt ? String(input.startedAt) : new Date().toISOString(),
    completedAt: input.completedAt ? String(input.completedAt) : null,
    outcome: ['running', 'success', 'partial', 'failed', 'cancelled'].includes(input.outcome) ? input.outcome : 'running',
    stage: cleanText(input.stage, 80, 'queued'),
    summary: cleanText(input.summary, 1000),
    details: Array.isArray(input.details) ? input.details.slice(0, 100).map((detail) => ({
      time: detail?.time ? String(detail.time) : new Date().toISOString(),
      stage: cleanText(detail?.stage, 80),
      serverId: cleanText(detail?.serverId, 100),
      serverName: cleanText(detail?.serverName, 100),
      outcome: cleanText(detail?.outcome, 30),
      message: cleanText(detail?.message, 700)
    })) : []
  };
}

function formatScheduleTime(scheduleInput) {
  const schedule = normalizeSchedule(scheduleInput);
  const hour = schedule.hour % 12 || 12;
  const suffix = schedule.hour >= 12 ? 'PM' : 'AM';
  return `${hour}:${String(schedule.minute).padStart(2, '0')} ${suffix}`;
}

module.exports = {
  MAX_SCHEDULES,
  MAX_HISTORY,
  DEFAULT_WARNING_MINUTES,
  normalizeSchedule,
  normalizeSchedulerConfig,
  normalizeHistoryEntry,
  normalizeWarnings,
  nextOccurrence,
  relevantOccurrence,
  occurrenceKey,
  dueWarning,
  warningText,
  formatScheduleTime,
  clone
};

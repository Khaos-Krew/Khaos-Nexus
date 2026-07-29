'use strict';

const { errorFingerprint, redactText } = require('./redaction.cjs');

const MAX_RENDERER_ACTION_ERRORS = 100;
const VALID_SOURCES = new Set(['ipc', 'window-error', 'unhandled-rejection', 'initialization', 'manual']);

function cleanText(value, max, fallback = '') {
  const text = String(value ?? '').replace(/\u0000/g, '').trim();
  return (text || fallback).slice(0, max);
}

function errorText(value) {
  if (value instanceof Error) return `${value.code || ''} ${value.message || ''} ${value.stack || ''}`;
  if (value && typeof value === 'object') return `${value.code || ''} ${value.message || ''} ${value.stack || ''}`;
  return String(value || '');
}

function isExpectedAccessDenial(value) {
  const text = errorText(value).toLowerCase();
  if (!text) return false;
  if (/\baccess_denied\b|\bmodule_disabled\b/.test(text)) return true;
  const requiresRole = /requires\s+(viewer|operator|owner)\s+access/.test(text);
  const authorizationReason = /sign in with an authorized discord account|discord account is not approved|configured owner account|desktop access control|access control is enabled/.test(text);
  const expectedModuleState = /requires an enabled nexus module|disabled by the owner|temporarily disabled by the khaos nexus owner|inventoried but has no runnable desktop implementation|is blocked because .+ disabled/.test(text);
  return (requiresRole && authorizationReason) || expectedModuleState;
}

function normalizeRendererActionError(input = {}, explicitSecrets = []) {
  const source = VALID_SOURCES.has(input.source) ? input.source : 'ipc';
  const channel = cleanText(input.channel, 140, source === 'ipc' ? 'unknown-ipc-action' : source);
  const view = cleanText(input.view, 100, 'unknown-view').replace(/^view-/, '');
  const elementId = cleanText(input.elementId, 120);
  const elementText = cleanText(input.elementText, 160);
  const elementTag = cleanText(input.elementTag, 40).toLowerCase();
  const message = redactText(cleanText(input.message, 1600, 'Unknown user-interface error'), explicitSecrets);
  const stack = redactText(cleanText(input.stack, 12000), explicitSecrets);
  const operation = cleanText(input.operation, 140, elementText || elementId || channel);
  const fingerprintSource = [source, channel, view, operation, message, stack].join('\n');
  const id = cleanText(input.id, 40) || errorFingerprint(fingerprintSource);
  const time = input.time && Number.isFinite(new Date(input.time).getTime()) ? new Date(input.time).toISOString() : new Date().toISOString();
  return {
    id,
    time,
    lastSeenAt: input.lastSeenAt && Number.isFinite(new Date(input.lastSeenAt).getTime()) ? new Date(input.lastSeenAt).toISOString() : time,
    occurrences: Math.max(1, Math.min(9999, Math.round(Number(input.occurrences) || 1))),
    source,
    channel,
    view,
    operation,
    elementId,
    elementText,
    elementTag,
    message,
    stack
  };
}

function rendererActionErrorSummary(entryInput) {
  const entry = normalizeRendererActionError(entryInput);
  const target = entry.elementText || entry.elementId || entry.operation || entry.channel;
  return `${target} failed on ${entry.view}: ${entry.message}`.slice(0, 2000);
}

function normalizeRendererActionErrorState(input = {}) {
  const entries = [];
  const seen = new Set();
  for (const source of Array.isArray(input.entries) ? input.entries : []) {
    const entry = normalizeRendererActionError(source);
    if (isExpectedAccessDenial(entry)) continue;
    const key = `${entry.id}:${entry.channel}:${entry.view}`;
    if (seen.has(key)) continue;
    seen.add(key);
    entries.push(entry);
  }
  entries.sort((a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime());
  return {
    entries: entries.slice(0, MAX_RENDERER_ACTION_ERRORS),
    totalCaptured: Math.max(entries.length, Number(input.totalCaptured) || entries.length),
    lastClearedAt: input.lastClearedAt ? String(input.lastClearedAt) : null
  };
}

module.exports = {
  MAX_RENDERER_ACTION_ERRORS,
  normalizeRendererActionError,
  normalizeRendererActionErrorState,
  rendererActionErrorSummary,
  isExpectedAccessDenial
};
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  BASELINE_DYNAMIC,
  EVENT_PRESETS,
  normalizeOverrides,
  createEvent,
  mergeConfig,
  renderIni,
  dueNotices,
  advanceRecurringEvent
} = require('../src/sentinel/ark-dynamic-events.cjs');

test('normalizes only confirmed ASA DynamicConfig keys by default', () => {
  const result = normalizeOverrides({ HarvestAmountMultiplier: 8, TamingSpeedMultiplier: 20, UnsafeKey: 'x' });
  assert.deepEqual(result.output, { HarvestAmountMultiplier: '8' });
  assert.deepEqual(result.rejected.sort(), ['TamingSpeedMultiplier', 'UnsafeKey']);
});

test('experimental keys require explicit opt-in', () => {
  const result = normalizeOverrides({ TamingSpeedMultiplier: 20 }, { allowExperimental: true });
  assert.deepEqual(result.output, { TamingSpeedMultiplier: '20' });
  assert.deepEqual(result.rejected, []);
});

test('event precedence is baseline then map then active event then admin override', () => {
  const now = Date.parse('2026-09-04T20:00:00Z');
  const state = {
    baseline: { ...BASELINE_DYNAMIC },
    mapOverrides: { ARK_GEN1: { HarvestAmountMultiplier: '6.0', XPMultiplier: '6.0' } },
    adminOverrides: { ARK_GEN1: { XPMultiplier: '9.0' } },
    events: [{
      id: 'ARKEVT-TEST', enabled: true, status: 'scheduled', maps: ['ARK_GEN1'],
      startAt: '2026-09-04T19:00:00Z', endAt: '2026-09-04T22:00:00Z',
      overrides: { HarvestAmountMultiplier: '10.0', XPMultiplier: '7.5' }
    }]
  };
  const merged = mergeConfig(state, 'ARK_GEN1', now);
  assert.equal(merged.config.HarvestAmountMultiplier, '10.0');
  assert.equal(merged.config.XPMultiplier, '9.0');
  assert.equal(merged.activeEvents.length, 1);
});

test('inactive events do not change baseline', () => {
  const state = {
    baseline: { ...BASELINE_DYNAMIC }, mapOverrides: {}, adminOverrides: {},
    events: [{
      id: 'ARKEVT-FUTURE', enabled: true, status: 'scheduled', maps: ['ARK_GEN1'],
      startAt: '2026-09-10T00:00:00Z', endAt: '2026-09-11T00:00:00Z',
      overrides: { HarvestAmountMultiplier: '10.0' }
    }]
  };
  const merged = mergeConfig(state, 'ARK_GEN1', Date.parse('2026-09-01T00:00:00Z'));
  assert.equal(merged.config.HarvestAmountMultiplier, BASELINE_DYNAMIC.HarvestAmountMultiplier);
  assert.equal(merged.activeEvents.length, 0);
});

test('taming preset is marked experimental and shiny is notification-only', () => {
  assert.equal(EVENT_PRESETS.taming.experimental, true);
  assert.equal(EVENT_PRESETS.shiny.notificationOnly, true);
  assert.deepEqual(EVENT_PRESETS.shiny.overrides, {});
});

test('createEvent validates time ordering and map defaults', () => {
  const event = createEvent({ preset: 'breeding', startAt: '2026-09-04T18:00-05:00', endAt: '2026-09-05T00:00-05:00' });
  assert.equal(event.preset, 'breeding');
  assert.deepEqual(event.maps, ['ARK_GEN1']);
  assert.throws(() => createEvent({ preset: 'harvest', startAt: '2026-09-05T00:00Z', endAt: '2026-09-04T00:00Z' }), /after startAt/);
});

test('renderIni is deterministic in key ordering', () => {
  const text = renderIni({ XPMultiplier: '5.0', HarvestAmountMultiplier: '10.0' });
  assert.match(text, /HarvestAmountMultiplier=10\.0[\s\S]*XPMultiplier=5\.0/);
  assert.equal(text.endsWith('\n'), true);
});

test('dueNotices deduplicates already-recorded notices', () => {
  const event = { id: 'ARKEVT-X', startAt: '2026-09-05T00:00:00Z', endAt: '2026-09-05T02:00:00Z' };
  const now = Date.parse('2026-09-04T23:00:00Z');
  const state = { noticeLog: {} };
  let due = dueNotices(event, state, now, [3600]);
  assert.equal(due.length, 1);
  state.noticeLog[due[0].key] = { at: new Date(now).toISOString() };
  due = dueNotices(event, state, now, [3600]);
  assert.equal(due.length, 0);
});

test('weekly recurrence advances both start and end exactly seven days', () => {
  const event = { recurrence: 'weekly', startAt: '2026-09-04T23:00:00Z', endAt: '2026-09-05T01:00:00Z', status: 'completed' };
  assert.equal(advanceRecurringEvent(event), true);
  assert.equal(event.startAt, '2026-09-11T23:00:00.000Z');
  assert.equal(event.endAt, '2026-09-12T01:00:00.000Z');
  assert.equal(event.status, 'scheduled');
});
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { preflightSessionStart } = require('../bot/dnd-runtime-policy.cjs');

const guildId = '100000000000000001';
const channelId = '100000000000000002';

function interactionFor(sessionId) {
  return {
    commandName: 'session',
    guildId,
    channelId,
    channel: {},
    isChatInputCommand: () => true,
    options: {
      getSubcommand: () => 'start',
      getString: (name) => name === 'session' ? sessionId : ''
    }
  };
}

function runtimeWith(status) {
  return {
    getBootstrap: () => ({
      config: {
        discordApp: { id: 'app' },
        dnd: {
          bindings: [{
            campaignId: 'campaign', appId: 'app', guildId,
            resourceType: 'channel', resourceId: channelId,
            purpose: 'main', active: true
          }],
          channelContexts: [],
          sessions: [{ id: 'session', campaignId: 'campaign', status }]
        }
      }
    })
  };
}

test('session command preflight accepts a planned session', () => {
  assert.doesNotThrow(() => preflightSessionStart(interactionFor('session'), runtimeWith('planned')));
});

test('session command preflight rejects completed and active sessions', () => {
  assert.throws(() => preflightSessionStart(interactionFor('session'), runtimeWith('completed')), (error) => error.code === 'SESSION_NOT_STARTABLE');
  assert.throws(() => preflightSessionStart(interactionFor('session'), runtimeWith('active')), (error) => error.code === 'SESSION_NOT_STARTABLE');
});

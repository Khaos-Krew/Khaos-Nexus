'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregateApprovedHosts } = require('../src/sentinel/hosted-server-manager-extension.cjs');

test('host title eligibility stays active when any approved server for the member is still active', () => {
  const active = new Set(['SRV-ACTIVE']);
  const hosts = aggregateApprovedHosts([
    { applicantDiscordId:'123456789012345678', approvedServerId:'SRV-RETIRED' },
    { applicantDiscordId:'123456789012345678', approvedServerId:'SRV-ACTIVE' }
  ], active);
  const host = hosts.get('123456789012345678');
  assert.equal(host.approvedApplications,2);
  assert.equal(host.activeServerCount,1);
});

test('host title eligibility becomes inactive only when none of the member approved servers remain active', () => {
  const hosts = aggregateApprovedHosts([
    { applicantDiscordId:'123456789012345678', approvedServerId:'SRV-OLD-A' },
    { applicantDiscordId:'123456789012345678', approvedServerId:'SRV-OLD-B' }
  ], new Set(['SRV-SOMEONE-ELSE']));
  assert.equal(hosts.get('123456789012345678').activeServerCount,0);
});

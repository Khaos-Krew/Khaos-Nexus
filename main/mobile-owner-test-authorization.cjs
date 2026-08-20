'use strict';

// ADR-009 / issue #276: isolated owner-test authorization only.
// This file is intentionally present only on owner-test/android-resume-v0.41.2.
// Do not merge it into the normal stabilization or release line.
module.exports = Object.freeze({
  enabled: true,
  scope: 'owner-test',
  architectureDecision: 'ADR-009',
  trackingIssue: 276,
  desktopBaseline: 'v0.41.2-B'
});

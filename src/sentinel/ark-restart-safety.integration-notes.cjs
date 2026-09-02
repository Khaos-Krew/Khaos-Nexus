'use strict';

// Restart safety invariant:
// Host-level ARK restarts must flow through the restart coordinator in
// ark-restart-scheduler-extension.cjs. Direct CitadelControlClient.restart()
// calls from staff/update handlers are prohibited because they bypass the
// zero-player / 30-minute-warning + dual-save safety gate.

module.exports = Object.freeze({
  invariant: 'all-host-restarts-through-restart-coordinator'
});

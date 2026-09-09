'use strict';

// Canonical Sentinel entry point.
// Temporary compatibility bridge: the legacy misspelled entry point remains
// in place until Railway is cut over and all SENTINAL_* configuration aliases
// have been migrated.
require('./sentinal-service.cjs');

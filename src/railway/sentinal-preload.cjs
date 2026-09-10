'use strict';

// Keep Railway's explicit start command and the Docker runtime on the same
// preload contract. These modules must initialize before sentinal-service.cjs
// creates/logs in the Discord client.
require('../sentinel/arn-parser-runtime-patch.cjs');
require('../sentinel/arn-poll-reconcile-worker.cjs');
require('../sentinel/ark-ssh-probe-startup.cjs');

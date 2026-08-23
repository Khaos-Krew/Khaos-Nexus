'use strict';

const { bootstrapHostedProviderStore } = require('./hosted-provider-store.cjs');

process.env.NEXUS_BACKEND_HOST ||= '127.0.0.1';
process.env.NEXUS_BACKEND_PORT ||= '3210';
process.env.NEXUS_BACKEND_URL ||= `http://${process.env.NEXUS_BACKEND_HOST}:${process.env.NEXUS_BACKEND_PORT}`;

const hosted = bootstrapHostedProviderStore();
if (hosted.secretState.failed.length) {
  console.warn(`[Nexus Sentinal] ${hosted.secretState.failed.length} hosted provider credential(s) could not be decrypted; affected providers will remain unavailable until credentials are synced again.`);
}

console.log('[Nexus Sentinal] starting Railway composite runtime');
require('../backend/server.cjs');
require('../sentinel/entry.cjs');
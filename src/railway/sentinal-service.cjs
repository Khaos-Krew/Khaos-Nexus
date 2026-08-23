'use strict';

process.env.NEXUS_BACKEND_HOST ||= '127.0.0.1';
process.env.NEXUS_BACKEND_PORT ||= '3210';
process.env.NEXUS_BACKEND_URL ||= `http://${process.env.NEXUS_BACKEND_HOST}:${process.env.NEXUS_BACKEND_PORT}`;

console.log('[Nexus Sentinal] starting Railway composite runtime');
require('../backend/server.cjs');
require('../sentinel/entry.cjs');
'use strict';

const http = require('node:http');

function send(response, status, body) {
  const content = JSON.stringify(body);
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(content), 'cache-control': 'no-store' });
  response.end(content);
}

function authorized(request, config) {
  if (!config.apiToken) return false;
  return request.headers.authorization === `Bearer ${config.apiToken}`;
}

async function readJson(request, limit = 256_000) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > limit) throw Object.assign(new Error('payload_too_large'), { statusCode: 413 });
  }
  try { return JSON.parse(body || '{}'); }
  catch { throw Object.assign(new Error('invalid_json'), { statusCode: 400 }); }
}

function validIdentifier(value, prefix) {
  return typeof value === 'string' && value.startsWith(prefix) && /^[A-Z0-9_.-]+$/.test(value) && value.length <= 100;
}

function createHealthServer(config, store, runtime) {
  return http.createServer(async (request, response) => {
    const pathname = new URL(request.url, 'http://worker.local').pathname;
    if (request.method === 'GET' && pathname === '/health') {
      try {
        await store.ping();
        return send(response, 200, { ok: true, nodeId: config.nodeId, lane: config.lane, capabilities: config.capabilities, state: runtime.state, activeJobId: runtime.activeJobId, commitSha: process.env.RAILWAY_GIT_COMMIT_SHA || 'local', uptimeSeconds: Math.floor(process.uptime()) });
      } catch (error) { return send(response, 503, { ok: false, nodeId: config.nodeId, error: error.message }); }
    }
    if (request.method === 'GET' && pathname === '/ready') {
      return send(response, runtime.ready ? 200 : 503, { ready: runtime.ready, nodeId: config.nodeId });
    }
    if (request.method === 'GET' && pathname === '/cluster') {
      if (!authorized(request, config)) return send(response, 401, { error: 'unauthorized' });
      try { return send(response, 200, await store.snapshot()); }
      catch (error) { return send(response, 500, { error: error.message }); }
    }
    if (request.method === 'POST' && ['/releases', '/jobs'].includes(pathname)) {
      if (!authorized(request, config)) return send(response, 401, { error: 'unauthorized' });
      try {
        const body = await readJson(request);
        if (pathname === '/releases') {
          if (!validIdentifier(body.releaseId, 'NX-') || !body.target || !body.artifactType || !/^[0-9a-f]{7,40}$/i.test(String(body.commitSha || ''))) {
            return send(response, 400, { error: 'invalid_release' });
          }
          return send(response, 201, await store.createRelease(body));
        }
        if (!validIdentifier(body.jobId, 'NX-') || !['build', 'test', 'validation', 'deploy'].includes(body.stage)
          || !['forge', 'ark', 'general'].includes(body.lane || 'general') || !config.allowedRepos.has(body.repository)
          || typeof body.gitRef !== 'string' || body.gitRef.length > 240) return send(response, 400, { error: 'invalid_job' });
        return send(response, 201, await store.enqueueJob(body));
      } catch (error) { return send(response, error.statusCode || 500, { error: error.message }); }
    }
    const approvalMatch = pathname.match(/^\/releases\/([A-Z0-9_.-]+)\/approve$/);
    if (request.method === 'POST' && approvalMatch) {
      if (!authorized(request, config)) return send(response, 401, { error: 'unauthorized' });
      try { return send(response, 200, await store.approveRelease(approvalMatch[1])); }
      catch (error) { return send(response, error.statusCode || 500, { error: error.message }); }
    }
    return send(response, 404, { error: 'not_found' });
  });
}

module.exports = { createHealthServer };

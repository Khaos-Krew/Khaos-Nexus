'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { jsonContentTypeAccepted } = require('../src/economy-worker/server.cjs');

function requestWith(contentType) {
  const headers = {};
  if (contentType !== undefined) headers['content-type'] = contentType;
  return { headers };
}

test('economy POST content type gate preserves omitted-header compatibility', () => {
  assert.equal(jsonContentTypeAccepted(requestWith(undefined)), true);
  assert.equal(jsonContentTypeAccepted(requestWith('')), true);
});

test('economy POST content type gate accepts JSON media types', () => {
  for (const value of [
    'application/json',
    'Application/JSON; charset=utf-8',
    'application/problem+json',
    'application/vnd.khaos-nexus.wallet+json; charset=UTF-8'
  ]) {
    assert.equal(jsonContentTypeAccepted(requestWith(value)), true, value);
  }
});

test('economy POST content type gate rejects explicit non-JSON media types', () => {
  for (const value of [
    'text/plain',
    'application/x-www-form-urlencoded',
    'multipart/form-data; boundary=nexus',
    'text/json',
    'application/jsonp'
  ]) {
    assert.equal(jsonContentTypeAccepted(requestWith(value)), false, value);
  }
});

test('explicit non-JSON POST bodies are rejected before body buffering', () => {
  const source = fs.readFileSync(path.join(__dirname, '../src/economy-worker/server.cjs'), 'utf8');
  const contentTypeGate = source.indexOf('if (!jsonContentTypeAccepted(req))');
  const bodyRead = source.indexOf('const input = await body(req);');

  assert.notEqual(contentTypeGate, -1);
  assert.notEqual(bodyRead, -1);
  assert.ok(contentTypeGate < bodyRead);
  assert.match(source, /return json\(res, 415, \{ ok: false, error: 'unsupported-media-type' \}\);/);
});

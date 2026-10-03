'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '../../src/shared/brand-assets');
const COLOR_MODES = new Map([
  [0, 'L'],
  [2, 'RGB'],
  [3, 'P'],
  [4, 'LA'],
  [6, 'RGBA']
]);

function pngInfo(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
  assert.equal(buffer.subarray(12, 16).toString('ascii'), 'IHDR');
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
    mode: COLOR_MODES.get(buffer[25]) || String(buffer[25])
  };
}

function manifestEntry(manifest, name) {
  const entry = manifest[name];
  if (typeof entry === 'string') return { sha256: entry };
  return entry || {};
}

test('vanguard brand assets match MANIFEST.json and are lossless PNGs', () => {
  const names = fs.readdirSync(DIR);
  const rejected = names.filter((name) => /\.(?:webp|jpe?g)$/i.test(name));
  assert.deepEqual(rejected, []);
  const manifest = JSON.parse(fs.readFileSync(path.join(DIR, 'MANIFEST.json'), 'utf8'));
  const expected = {
    'vanguard-panel-banner.png': { width: 1200, height: 400, mode: 'RGB' },
    'icon-vanguard.png': { width: 512, height: 512, mode: 'RGB' }
  };
  for (const [name, size] of Object.entries(expected)) {
    const buffer = fs.readFileSync(path.join(DIR, name));
    const info = pngInfo(buffer);
    const entry = manifestEntry(manifest, name);
    const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
    assert.equal(sha256, entry.sha256);
    assert.equal(info.width, entry.width || size.width);
    assert.equal(info.height, entry.height || size.height);
    assert.equal(info.mode, entry.mode || size.mode);
    if (entry.bytes != null) assert.equal(buffer.length, entry.bytes);
    assert.equal(info.width, size.width);
    assert.equal(info.height, size.height);
    assert.equal(info.mode, size.mode);
  }
});

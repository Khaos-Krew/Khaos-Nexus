'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const https = require('node:https');

function download(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, { headers: { 'user-agent': 'Khaos-Nexus-Catalog-Probe/1.0' } }, (response) => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location && redirects > 0) {
        response.resume();
        resolve(download(new URL(response.headers.location, url).toString(), redirects - 1));
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        return;
      }
      const hash = crypto.createHash('sha256');
      let bytes = 0;
      response.on('data', (chunk) => { bytes += chunk.length; hash.update(chunk); });
      response.on('end', () => resolve({ url, bytes, sha256: hash.digest('hex') }));
    });
    request.setTimeout(120000, () => request.destroy(new Error(`Timeout for ${url}`)));
    request.on('error', reject);
  });
}

test('temporary official SRD hash probe', async () => {
  const results = await Promise.all([
    download('https://media.dndbeyond.com/compendium-images/srd/5.2/SRD_CC_v5.2.1.pdf'),
    download('https://media.wizards.com/2023/downloads/dnd/SRD_CC_v5.1.pdf')
  ]);
  assert.fail(`DND_CATALOG_HASH_RESULTS=${JSON.stringify(results)}`);
});

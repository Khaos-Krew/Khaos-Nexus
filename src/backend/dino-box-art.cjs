'use strict';

const ART_ENV = Object.freeze({
  coastal: 'NEXUS_DINO_BOX_ART_COASTAL_B64',
  forest: 'NEXUS_DINO_BOX_ART_FOREST_B64',
  swamp: 'NEXUS_DINO_BOX_ART_SWAMP_B64',
  mountain: 'NEXUS_DINO_BOX_ART_MOUNTAIN_B64',
  ocean: 'NEXUS_DINO_BOX_ART_OCEAN_B64',
  deepcave: 'NEXUS_DINO_BOX_ART_DEEPCAVE_B64',
  apex: 'NEXUS_DINO_BOX_ART_APEX_B64',
  'fantastical-tames': 'NEXUS_DINO_BOX_ART_FANTASTICAL_TAMES_B64',
  'bobs-tall-tales': 'NEXUS_DINO_BOX_ART_BOBS_TALL_TALES_B64'
});

const ID_PATTERN = /^[a-z0-9-]{1,48}$/;

function normalizeArtId(value) {
  const id = String(value || '').trim().toLowerCase();
  return ID_PATTERN.test(id) && ART_ENV[id] ? id : '';
}

function artBuffer(cacheId, env = process.env) {
  const id = normalizeArtId(cacheId);
  if (!id) return null;
  const encoded = String(env[ART_ENV[id]] || '').trim();
  if (!encoded || !/^[A-Za-z0-9+/=]+$/.test(encoded)) return null;
  const buffer = Buffer.from(encoded, 'base64');
  if (buffer.length < 100 || buffer.length > 512 * 1024) return null;
  if (buffer.subarray(0, 4).toString('ascii') !== 'RIFF' || buffer.subarray(8, 12).toString('ascii') !== 'WEBP') return null;
  return buffer;
}

function sendArt(res, cacheId, env = process.env) {
  const buffer = artBuffer(cacheId, env);
  if (!buffer) return false;
  res.writeHead(200, {
    'content-type': 'image/webp',
    'content-length': buffer.length,
    'cache-control': 'public, max-age=86400, stale-while-revalidate=604800',
    'x-content-type-options': 'nosniff'
  });
  res.end(buffer);
  return true;
}

module.exports = { ART_ENV, normalizeArtId, artBuffer, sendArt };

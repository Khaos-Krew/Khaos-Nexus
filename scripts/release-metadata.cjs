'use strict';

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function latestYmlAdvertisesVersion(latest, version) {
  const normalizedVersion = String(version || '').trim();
  if (!normalizedVersion) return false;
  const escaped = escapeRegExp(normalizedVersion);
  return new RegExp(`^version:\\s*${escaped}\\s*$`, 'm').test(String(latest || ''));
}

module.exports = {
  escapeRegExp,
  latestYmlAdvertisesVersion
};

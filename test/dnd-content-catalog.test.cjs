'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');
const {
  BUILTIN_CATALOG,
  CATALOG_REPOSITORY,
  CATALOG_REF,
  CATALOG_PATH,
  normalizeCatalog,
  mergeCatalogs,
  verifyGithubCatalogCommit,
  parseCharacterImportBuffer,
  normalizeHomebrewSource,
  verifyPackBuffer,
  catalogView
} = require('../shared/dnd-content-catalog.cjs');
const {
  validateHomebrewSourceDraft,
  validateImportReview,
  statusLabel
} = require('../renderer/dnd-content-catalog.js');

function pdfPack(buffer, overrides = {}) {
  return {
    id: 'test-free-pack', name: 'Test Free Pack', description: 'Test', ruleset: '5e_2024', version: '1.0', language: 'en',
    publisher: 'Test Publisher', licenseId: 'CC-BY-4.0', licenseName: 'Creative Commons Attribution 4.0 International',
    licenseUrl: 'https://creativecommons.org/licenses/by/4.0/', attributionText: 'Test attribution.',
    downloadUrl: 'https://media.wizards.com/test/test-free-pack.pdf', fileName: 'test-free-pack.pdf', mimeType: 'application/pdf',
    bytes: buffer.length, sha256: crypto.createHash('sha256').update(buffer).digest('hex'), contentOrigin: 'srd', fullTextAllowed: true, active: true,
    ...overrides
  };
}

test('built-in catalog contains the exact verified official SRD packages', () => {
  const catalog = normalizeCatalog(BUILTIN_CATALOG, 'builtin');
  assert.equal(catalog.packs.length, 2);
  const modern = catalog.packs.find((pack) => pack.id === 'wotc-srd-5.2.1-en');
  const legacy = catalog.packs.find((pack) => pack.id === 'wotc-srd-5.1-en');
  assert.equal(modern.bytes, 6031375);
  assert.equal(modern.sha256, '8974902d109d6e63672d7c490bde9ccf052410503d9cfa768237154fbc5e3d87');
  assert.equal(legacy.bytes, 3158713);
  assert.equal(legacy.sha256, '2504d2a0abb0a4d491a939be4f17910a2dde0312570ab8d208080225ccf0a1f0');
  assert.ok(catalog.packs.every((pack) => pack.licenseId === 'CC-BY-4.0' && pack.fullTextAllowed));
});

test('remote catalog additions appear without changing the built-in catalog', () => {
  const buffer = Buffer.from('%PDF-test-pack');
  const remote = { schemaVersion: 1, catalogVersion: '2', generatedAt: '2026-08-02T00:00:00Z', packs: [pdfPack(buffer)] };
  const merged = mergeCatalogs(BUILTIN_CATALOG, remote);
  assert.equal(BUILTIN_CATALOG.packs.length, 2);
  assert.equal(merged.packs.length, 3);
  assert.ok(merged.packs.some((pack) => pack.id === 'test-free-pack'));
});

test('catalog rejects unapproved download hosts, invalid hashes, duplicate IDs and paid-content shortcuts', () => {
  const buffer = Buffer.from('%PDF-test-pack');
  assert.throws(() => normalizeCatalog({ schemaVersion: 1, packs: [pdfPack(buffer, { downloadUrl: 'https://example.com/book.pdf' })] }), (error) => error.code === 'DND_CATALOG_HOST_UNTRUSTED');
  assert.throws(() => normalizeCatalog({ schemaVersion: 1, packs: [pdfPack(buffer, { sha256: 'bad' })] }), (error) => error.code === 'DND_PACK_HASH_INVALID');
  assert.throws(() => normalizeCatalog({ schemaVersion: 1, packs: [pdfPack(buffer), pdfPack(buffer)] }), (error) => error.code === 'DND_CATALOG_DUPLICATE');
  assert.throws(() => normalizeCatalog({ schemaVersion: 1, packs: [pdfPack(buffer, { attributionText: '', licenseId: '' })] }), (error) => error.code === 'DND_PACK_LICENSE_REQUIRED');
});

test('remote catalog trust is pinned to repository, ref, path, actor, and commit SHA', () => {
  const value = verifyGithubCatalogCommit({ repository: CATALOG_REPOSITORY, ref: CATALOG_REF, path: CATALOG_PATH, actor: 'KhaosKrew-Kirito', sha: 'a'.repeat(40) });
  assert.equal(value.verified, true);
  assert.throws(() => verifyGithubCatalogCommit({ repository: 'someone/else', ref: CATALOG_REF, path: CATALOG_PATH, actor: 'KhaosKrew-Kirito', sha: 'a'.repeat(40) }), /not trusted/);
  assert.throws(() => verifyGithubCatalogCommit({ repository: CATALOG_REPOSITORY, ref: CATALOG_REF, path: CATALOG_PATH, actor: 'unknown', sha: 'a'.repeat(40) }), /actor/);
});

test('download verification rejects size, hash, and file-signature tampering', () => {
  const buffer = Buffer.from('%PDF-test-pack');
  const pack = pdfPack(buffer);
  assert.deepEqual(verifyPackBuffer(pack, buffer), { bytes: buffer.length, sha256: pack.sha256, verified: true });
  assert.throws(() => verifyPackBuffer(pack, Buffer.concat([buffer, Buffer.from('x')])), (error) => error.code === 'DND_PACK_SIZE_MISMATCH');
  const changed = Buffer.from('%PDF-best-pack');
  assert.equal(changed.length, buffer.length);
  assert.throws(() => verifyPackBuffer(pack, changed), (error) => error.code === 'DND_PACK_HASH_MISMATCH');
  const invalidSignature = Buffer.from('xxxxx-test-pack');
  const invalidPack = pdfPack(invalidSignature);
  assert.throws(() => verifyPackBuffer(invalidPack, invalidSignature), (error) => error.code === 'DND_PACK_SIGNATURE_INVALID');
});

test('catalog view reports explicit available, installed, and repair states without automatic actions', () => {
  const view = catalogView(BUILTIN_CATALOG, []);
  assert.ok(view.every((pack) => pack.status === 'available'));
  const installed = [{ packId: view[0].id, version: view[0].version, sha256: view[0].sha256, bytes: view[0].bytes, installed: true }];
  assert.equal(catalogView(BUILTIN_CATALOG, installed).find((pack) => pack.id === view[0].id).status, 'installed');
  installed[0].sha256 = '0'.repeat(64);
  assert.equal(catalogView(BUILTIN_CATALOG, installed).find((pack) => pack.id === view[0].id).status, 'invalid');
  assert.equal(statusLabel('update_available'), 'Update available');
});

test('Homebrew source is explicitly user-authored and permits custom full text', () => {
  const renderer = validateHomebrewSourceDraft({ name: 'Moonfall Rules', author: 'GM', ruleset: '5e_2024', visibility: 'campaign', externalReferenceUrl: 'https://example.test/moonfall' });
  const source = normalizeHomebrewSource(renderer);
  assert.equal(source.licenseType, 'user_authored');
  assert.equal(source.isFullTextAllowed, true);
  assert.equal(source.metadata.kind, 'homebrew_source');
  assert.equal(source.metadata.visibility, 'campaign');
  assert.throws(() => validateHomebrewSourceDraft({ name: 'Bad', externalReferenceUrl: 'http://example.test' }), /HTTPS/);
});

test('Khaos Nexus character import preserves provenance and unknown fields without retaining imported IDs', () => {
  const payload = Buffer.from(JSON.stringify({
    format: 'khaos-nexus-character-v1',
    character: {
      id: 'must-not-overwrite', name: 'Vex', className: 'Ranger', level: 7, hp: 38, maxHp: 42, armorClass: 16,
      conditions: ['poisoned', 'poisoned'], abilities: { dex: { score: 18 }, wisdom: 3 }, customInventory: ['rope']
    }
  }));
  const imported = parseCharacterImportBuffer(payload, { campaignId: 'campaign-1', sourceFileName: 'vex.json', importedAt: '2026-08-01T00:00:00Z' });
  assert.equal(imported.id, undefined);
  assert.equal(imported.campaignId, 'campaign-1');
  assert.equal(imported.abilityModifiers.dexterity, 4);
  assert.equal(imported.abilityModifiers.wisdom, 3);
  assert.deepEqual(imported.conditions, ['poisoned']);
  assert.deepEqual(imported.metadata.import.unknownFields.customInventory, ['rope']);
  assert.match(imported.metadata.import.sourceSha256, /^[a-f0-9]{64}$/);
  const review = validateImportReview(imported);
  assert.equal(review.id, undefined);
  assert.equal(review.name, 'Vex');
});

test('generic character imports map common field aliases and enforce numeric bounds', () => {
  const imported = parseCharacterImportBuffer(Buffer.from(JSON.stringify({ character_name: 'Brakka', class: 'Fighter', character_level: 4, current_hp: 22, max_hp: 30, ac: 17, initiative_modifier: 2 })), { campaignId: 'c' });
  assert.equal(imported.name, 'Brakka');
  assert.equal(imported.className, 'Fighter');
  assert.equal(imported.armorClass, 17);
  assert.throws(() => parseCharacterImportBuffer(Buffer.from(JSON.stringify({ name: 'Bad', hp: 20, maxHp: 10 })), { campaignId: 'c' }), /HP/);
});

test('character imports reject malformed JSON and excessive nesting', () => {
  assert.throws(() => parseCharacterImportBuffer(Buffer.from('{bad'), { campaignId: 'c' }), (error) => error.code === 'DND_CHARACTER_IMPORT_JSON_INVALID');
  let nested = { name: 'Deep' };
  for (let index = 0; index < 20; index += 1) nested = { name: 'Deep', nested };
  assert.throws(() => parseCharacterImportBuffer(Buffer.from(JSON.stringify(nested)), { campaignId: 'c' }), (error) => error.code === 'DND_CHARACTER_IMPORT_COMPLEX');
});

test('production loader, Owner IPC, protected storage and renderer controls are wired', () => {
  const entry = fs.readFileSync(require.resolve('../main/entry.cjs'), 'utf8');
  const extension = fs.readFileSync(require.resolve('../main/dnd-content-catalog-extension.cjs'), 'utf8');
  const renderer = fs.readFileSync(require.resolve('../renderer/dnd-content-catalog.js'), 'utf8');
  assert.ok(entry.indexOf('dnd-world-content-extension') < entry.indexOf('dnd-content-catalog-extension'));
  assert.ok(entry.indexOf('dnd-content-catalog-extension') < entry.indexOf('dnd-access-policy-extension'));
  for (const channel of ['dnd:catalog-get', 'dnd:catalog-refresh', 'dnd:catalog-install', 'dnd:catalog-remove', 'dnd:homebrew-source-save', 'dnd:character-import-pick']) assert.match(extension, new RegExp(channel.replace(':', '\\:')));
  assert.match(extension, /assertOwner/);
  assert.match(extension, /safeInside/);
  assert.match(extension, /verifyPackBuffer/);
  assert.match(renderer, /Check for New Content/);
  assert.match(renderer, /Homebrew \/ Custom Source/);
  assert.match(renderer, /Import Character/);
  assert.doesNotMatch(extension, /setInterval\([^)]*installPack/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {
  extractPdfFormFields,
  mapPdfFieldsToCharacter,
  parsePdfCharacterImportBuffer
} = require('../shared/dnd-character-pdf-import.cjs');

function escapePdf(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
}

function fillablePdf(fields = []) {
  const objects = fields.map((field, index) => {
    const type = field.type || 'Tx';
    const value = field.nameValue ? `/${field.value}` : `(${escapePdf(field.value ?? '')})`;
    return `${index + 1} 0 obj\n<< /FT /${type} /T (${escapePdf(field.name)}) /V ${value} >>\nendobj`;
  });
  return Buffer.from(`%PDF-1.7\n${objects.join('\n')}\n%%EOF\n`, 'latin1');
}

test('fillable PDF fields are extracted without OCR', () => {
  const buffer = fillablePdf([
    { name: 'CharacterName', value: 'Vorkesh Emberforge' },
    { name: 'ClassLevel', value: 'Artificer 6' },
    { name: 'Inspiration', value: 'Yes', type: 'Btn', nameValue: true }
  ]);
  const fields = extractPdfFormFields(buffer);
  assert.equal(fields.length, 3);
  assert.equal(fields[0].name, 'CharacterName');
  assert.equal(fields[0].value, 'Vorkesh Emberforge');
  assert.equal(fields[2].value, 'Yes');
});

test('D&D Beyond-style fillable PDF maps core character state and multiclass levels', async () => {
  const buffer = fillablePdf([
    { name: 'CharacterName', value: 'Vorkesh Emberforge' },
    { name: 'ClassLevel', value: 'Artificer 6 / Wizard 2' },
    { name: 'HPMax', value: '64' },
    { name: 'HPCurrent', value: '51' },
    { name: 'AC', value: '18' },
    { name: 'Initiative', value: '+3' },
    { name: 'Inspiration', value: 'Yes', type: 'Btn', nameValue: true },
    { name: 'STR', value: '16' },
    { name: 'DEX', value: '14' },
    { name: 'CON', value: '18' },
    { name: 'INT', value: '20' },
    { name: 'WIS', value: '12' },
    { name: 'CHA', value: '10' },
    { name: 'Race', value: 'Dragonborn' },
    { name: 'Background', value: 'Guild Artisan' },
    { name: 'PlayerName', value: 'Kirito' }
  ]);
  const imported = await parsePdfCharacterImportBuffer(buffer, {
    campaignId: 'campaign-1',
    sourceFileName: 'vorkesh.pdf',
    importedAt: '2026-08-08T17:40:00.000Z'
  });
  assert.equal(imported.name, 'Vorkesh Emberforge');
  assert.equal(imported.className, 'Artificer / Wizard');
  assert.equal(imported.level, 8);
  assert.equal(imported.hp, 51);
  assert.equal(imported.maxHp, 64);
  assert.equal(imported.armorClass, 18);
  assert.equal(imported.initiativeModifier, 3);
  assert.equal(imported.inspiration, true);
  assert.deepEqual(imported.abilityModifiers, {
    strength: 3,
    dexterity: 2,
    constitution: 4,
    intelligence: 5,
    wisdom: 1,
    charisma: 0
  });
  assert.equal(imported.metadata.import.format, 'dnd-character-pdf-form-v1');
  assert.equal(imported.metadata.pdfImport.ancestry, 'Dragonborn');
  assert.equal(imported.metadata.pdfImport.background, 'Guild Artisan');
  assert.match(imported.metadata.import.sourceSha256, /^[a-f0-9]{64}$/);
});

test('blank current HP falls back to maximum HP instead of importing zero', () => {
  const fields = extractPdfFormFields(fillablePdf([
    { name: 'CharacterName', value: 'Ember' },
    { name: 'ClassLevel', value: 'Artificer 4' },
    { name: 'HPMax', value: '37' },
    { name: 'HPCurrent', value: '' }
  ]));
  const mapped = mapPdfFieldsToCharacter(fields);
  assert.equal(mapped.hp, 37);
  assert.equal(mapped.maxHp, 37);
});

test('printed or flattened PDFs fail with an export-specific message', async () => {
  const buffer = Buffer.from('%PDF-1.7\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF\n', 'latin1');
  await assert.rejects(() => parsePdfCharacterImportBuffer(buffer, { campaignId: 'c' }), (error) => {
    assert.equal(error.code, 'DND_CHARACTER_PDF_FORM_REQUIRED');
    assert.match(error.message, /Export PDF rather than Print to PDF/);
    return true;
  });
});

test('desktop bootstrap and import override are wired for PDF and JSON', () => {
  const packageJson = JSON.parse(fs.readFileSync(require.resolve('../package.json'), 'utf8'));
  const bootstrap = fs.readFileSync(require.resolve('../main/entry-pdf-import.cjs'), 'utf8');
  const extension = fs.readFileSync(require.resolve('../main/dnd-character-pdf-import-extension.cjs'), 'utf8');
  assert.equal(packageJson.main, 'main/entry-pdf-import.cjs');
  assert.match(bootstrap, /dnd-character-pdf-import-extension/);
  assert.match(bootstrap, /require\('\.\/entry\.cjs'\)/);
  assert.match(extension, /extensions: \['pdf', 'json'\]/);
  assert.match(extension, /parsePdfCharacterImportBuffer/);
  assert.match(extension, /parseCharacterImportBuffer/);
  assert.match(extension, /dnd:character-import-pick/);
});

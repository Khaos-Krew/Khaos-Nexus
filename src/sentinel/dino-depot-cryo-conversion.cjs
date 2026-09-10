'use strict';

const { patchIniSection } = require('./ark-sftp-config.cjs');

const SECTION = 'DinoDepot';
const KEY = 'CryosAutoConvertToDinoballs';

function readConversionSetting(input) {
  const lines = String(input ?? '').replace(/\r\n/g, '\n').split('\n');
  const wanted = `[${SECTION}]`.toLowerCase();
  const start = lines.findIndex((line) => line.trim().toLowerCase() === wanted);
  if (start < 0) return { present: false, value: null };
  const values = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();
    if (/^\[.*\]$/.test(line)) break;
    if (!line || line.startsWith(';') || line.startsWith('#')) continue;
    const equals = line.indexOf('=');
    if (equals <= 0) continue;
    const key = line.slice(0, equals).trim();
    if (key.toLowerCase() !== KEY.toLowerCase()) continue;
    values.push(line.slice(equals + 1).trim());
  }
  if (!values.length) return { present: false, value: null };
  const normalized = [...new Set(values.map((value) => value.toLowerCase()))];
  if (normalized.length > 1) throw new Error(`Conflicting ${KEY} values exist in [${SECTION}]; refusing to normalize ambiguous live configuration.`);
  if (!/^(true|false)$/i.test(values[0])) throw new Error(`${KEY} must be True or False before Sentinel can manage it safely.`);
  return { present: true, value: /^true$/i.test(values[0]) };
}

function planCryopodAutoConversion(input, { enabled = false } = {}) {
  if (typeof enabled !== 'boolean') throw new TypeError('Dino Depot cryopod conversion enabled must be boolean.');
  const current = String(input ?? '');
  const previous = readConversionSetting(current);
  const desiredText = enabled ? 'True' : 'False';
  const next = patchIniSection(current, SECTION, { [KEY]: desiredText });
  return Object.freeze({
    section: SECTION,
    key: KEY,
    previous: previous.present ? previous.value : null,
    desired: enabled,
    changed: current !== next,
    next,
    safety: Object.freeze({
      automaticConversionEnabled: enabled,
      mutationScope: 'GameUserSettings.ini setting only',
      storedDinoRewrite: false,
      requiresRestart: current !== next,
      note: enabled
        ? 'Dino Depot performs conversion when vanilla cryopods enter a player inventory; this planner does not scan, rewrite, delete, or migrate existing Dino Depot storage.'
        : 'Automatic conversion remains disabled.'
    })
  });
}

async function configureCryopodAutoConversion({ prefix = 'ARK_GEN1', enabled = false, dryRun = true, confirmLive = false } = {}) {
  if (typeof enabled !== 'boolean') throw new TypeError('Dino Depot cryopod conversion enabled must be boolean.');
  if (!dryRun && confirmLive !== true) throw new Error('Live Dino Depot cryopod conversion config changes require confirmLive=true.');
  const { updateIniConfig } = require('./ark-config-manager.cjs');
  return updateIniConfig({
    prefix,
    fileKey: 'gus',
    dryRun,
    transform: (current) => planCryopodAutoConversion(current, { enabled }).next,
    guardCurrent: (current) => readConversionSetting(current)
  });
}

async function restoreCryopodConversionBackup({ prefix = 'ARK_GEN1', backup, confirmLive = false } = {}) {
  if (confirmLive !== true) throw new Error('Restoring a live Dino Depot config backup requires confirmLive=true.');
  const { restoreBackup } = require('./ark-config-manager.cjs');
  return restoreBackup({ prefix, fileKey: 'gus', backup });
}

module.exports = {
  SECTION,
  KEY,
  readConversionSetting,
  planCryopodAutoConversion,
  configureCryopodAutoConversion,
  restoreCryopodConversionBackup
};

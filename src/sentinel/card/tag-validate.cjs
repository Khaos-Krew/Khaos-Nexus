'use strict';

const fs = require('node:fs');
const path = require('node:path');

const TAG_CAP = 12;
const CATALOG_PATH = path.join(__dirname, 'games.catalog.json');
const PLATFORM_PATH = path.join(__dirname, 'platforms.catalog.json');
const POLICY_PATH = path.join(__dirname, 'tag-policy.json');

const LEET = Object.freeze({
  '0': 'o',
  '1': 'i',
  '3': 'e',
  '4': 'a',
  '5': 's',
  '7': 't',
  '8': 'b',
  '@': 'a',
  '$': 's'
});

const CONFUSABLES = Object.freeze({
  '\u0430': 'a',
  '\u03b1': 'a',
  '\u0435': 'e',
  '\u03b5': 'e',
  '\u0454': 'e',
  '\u043e': 'o',
  '\u03bf': 'o',
  '\u0440': 'p',
  '\u03c1': 'p',
  '\u0441': 'c',
  '\u03f2': 'c',
  '\u0445': 'x',
  '\u03c7': 'x',
  '\u0443': 'y',
  '\u0456': 'i',
  '\u03b9': 'i',
  '\u04cf': 'i',
  '\u0455': 's',
  '\u0442': 't',
  '\u04bb': 'h',
  '\u0501': 'd',
  '\u051b': 'q'
});

PLACEHOLDER_WILL_FAIL
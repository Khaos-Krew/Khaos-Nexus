'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { redactLogLine, relevantLogLines } = require('../src/sentinel/ark-api-log-diagnostic.cjs');

test('ArkShop API log redaction removes password and URI credentials', () => {
  const line = 'ArkShop mysql failed MysqlPass=super-secret mysql://dbuser:dbpass@database.internal:3306/shop';
  const safe = redactLogLine(line);
  assert.match(safe, /ArkShop mysql failed/);
  assert.doesNotMatch(safe, /super-secret|dbuser|dbpass/);
  assert.match(safe, /redacted/i);
});

test('ArkShop API log diagnostic keeps only bounded relevant lines', () => {
  const source = [
    'ordinary game line',
    'ArkShop loaded',
    'Mysql database error',
    'another unrelated line'
  ].join('\n');
  const lines = relevantLogLines(source, 20);
  assert.equal(lines.length, 2);
  assert.match(lines[0], /ArkShop/);
  assert.match(lines[1], /Mysql database error/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { TEMPLATE, parseSection, applyShinySection, shinySectionMatches } = require('../src/sentinel/ark-shiny-config-startup.cjs');

test('balanced Shiny updater changes only the Shiny section and never installs the webhook placeholder', () => {
  const template = fs.readFileSync(TEMPLATE, 'utf8');
  const before = '[ServerSettings]\nSessionName=Khaos Nexus\n\n[Shiny]\nMaxNumShinies=99\nDebugLogging=True\n\n[OtherMod]\nEnabled=True\n';
  const after = applyShinySection(before, template);
  assert.match(after, /\[ServerSettings\]\nSessionName=Khaos Nexus/);
  assert.match(after, /\[OtherMod\]\nEnabled=True/);
  assert.match(after, /\[Shiny\][\s\S]*MaxNumShinies=4/);
  assert.match(after, /DisableNotificationCoordinates=True/);
  assert.doesNotMatch(after, /ShinyDiscord|__SENTINEL_SHINY_WEBHOOK_URL__/);
  assert.equal(shinySectionMatches(after, parseSection(template, 'Shiny')), true);
});

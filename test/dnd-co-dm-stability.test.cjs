'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { ensureTab } = require('../renderer/dnd-co-dm-stability.js');

function fakeRoot() {
  const buttons = [];
  const tabs = {
    querySelector(selector) { return selector.includes('data-dnd-co-dm-tab') ? buttons[0] || null : null; },
    appendChild(button) { buttons.push(button); return button; }
  };
  return {
    buttons,
    querySelector(selector) {
      if (selector === '.dnd-tabs') return tabs;
      return null;
    }
  };
}

function fakeWindow(root) {
  return {
    document: {
      getElementById(id) { return id === 'view-dnd' ? root : null; },
      createElement() {
        return {
          dataset: {},
          classList: {
            active: false,
            toggle(_name, value) { this.active = Boolean(value); }
          }
        };
      }
    }
  };
}

test('Co-DM stability guard creates one reusable tab and restores active state', () => {
  const root = fakeRoot();
  const win = fakeWindow(root);
  const first = ensureTab(win, { active: true });
  const second = ensureTab(win, { active: false });
  assert.equal(first, second);
  assert.equal(root.buttons.length, 1);
  assert.equal(second.dataset.dndCoDmTab, 'co-dm');
  assert.equal(second.textContent, 'Co-DM');
  assert.equal(second.classList.active, false);
});

test('entry loads bounded stability immediately after Co-DM assets', () => {
  const root = path.join(__dirname, '..');
  const entry = fs.readFileSync(path.join(root, 'main', 'entry.cjs'), 'utf8');
  const coDm = entry.indexOf("require('./dnd-co-dm-extension.cjs').install()");
  const stability = entry.indexOf("require('./dnd-co-dm-stability-extension.cjs').install()");
  assert.ok(coDm >= 0);
  assert.ok(stability > coDm);

  const source = fs.readFileSync(path.join(root, 'renderer', 'dnd-co-dm-stability.js'), 'utf8');
  assert.doesNotMatch(source, /setInterval/);
  assert.match(source, /panel\?\.querySelector\('\.dnd-co-dm'\)/);
  assert.match(source, /state\.observer\?\.disconnect/);
});

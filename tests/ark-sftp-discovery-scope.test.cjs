'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { approvedConfigPath, configuredServerRoot } = require('../src/sentinel/ark-config-manager.cjs');
const { findRemoteFile } = require('../src/sentinel/ark-sftp-discovery.cjs');

function withEnv(values, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value == null) delete process.env[key]; else process.env[key] = String(value);
  }
  try { return fn(); }
  finally {
    for (const [key, value] of Object.entries(previous)) {
      if (value == null) delete process.env[key]; else process.env[key] = value;
    }
  }
}

test('configured server root is derived from an explicit sibling config path', () => {
  withEnv({
    ARK_MAP2_SFTP_ROOT: '',
    ARK_MAP2_GUS_PATH: '/instance-map2/ShooterGame/Saved/Config/WindowsServer/GameUserSettings.ini'
  }, () => assert.equal(configuredServerRoot('ARK_MAP2'), '/instance-map2'));
});

test('strict discovery never crosses into another visible game-service root', async () => {
  const files = new Set([
    'instance-map1/ShooterGame/Saved/Config/WindowsServer/Game.ini',
    'instance-map2/ShooterGame/Saved/Config/WindowsServer/Game.ini'
  ]);
  const lists = {
    'instance-map2': [{ name: 'ShooterGame', type: 'd' }],
    'instance-map2/ShooterGame': [{ name: 'Saved', type: 'd' }],
    'instance-map2/ShooterGame/Saved': [{ name: 'Config', type: 'd' }],
    'instance-map2/ShooterGame/Saved/Config': [{ name: 'WindowsServer', type: 'd' }],
    'instance-map2/ShooterGame/Saved/Config/WindowsServer': [{ name: 'Game.ini', type: '-' }],
    '.': [{ name: 'instance-map1', type: 'd' }, { name: 'instance-map2', type: 'd' }]
  };
  const client = {
    exists: async (remote) => files.has(String(remote).replace(/^\//, '')) ? '-' : false,
    list: async (remote) => lists[String(remote).replace(/^\//, '')] || []
  };
  const result = await findRemoteFile(client, {
    configuredRoot: 'instance-map2',
    configuredPath: 'ShooterGame/Saved/Config/WindowsServer/Game.ini',
    preferredSuffix: 'ShooterGame/Saved/Config/WindowsServer/Game.ini',
    fileName: 'Game.ini',
    strictRoot: true
  });
  assert.equal(result.path, 'instance-map2/ShooterGame/Saved/Config/WindowsServer/Game.ini');
});

test('only canonical live ARK config locations are accepted', () => {
  assert.equal(approvedConfigPath('gus', '/map2/ShooterGame/Saved/Config/WindowsServer/GameUserSettings.ini'), true);
  assert.equal(approvedConfigPath('game', '/map2/ShooterGame/Saved/Config/WindowsServer/Game.ini'), true);
  assert.equal(approvedConfigPath('arkshop', '/map2/ShooterGame/Binaries/Win64/ArkApi/Plugins/ArkShop/config.json'), true);
  assert.equal(approvedConfigPath('arkshop', '/map2/ShooterGame/Binaries/Win64/ArkApi/Plugins/ArkShop/Configs/config.json'), true);
  assert.equal(approvedConfigPath('game', '/map2/ConfigBackups/Game.ini'), false);
  assert.equal(approvedConfigPath('arkshop', '/map2/ShooterGame/Binaries/Win64/config.json'), false);
});

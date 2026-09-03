'use strict';

const { readConfig } = require('./ark-config-manager.cjs');
const { diffLiveIni } = require('./ark-source-of-truth.cjs');
const { serverIdFromPrefix } = require('./ark-sftp-config.cjs');

async function captureLiveConfigDiff({ prefix = 'ARK_GEN1' } = {}) {
  const serverId = serverIdFromPrefix(prefix);
  const [gus, game] = await Promise.all([
    readConfig(prefix, 'gus'),
    readConfig(prefix, 'game')
  ]);

  const diff = diffLiveIni({
    serverId,
    liveGameUserSettings: gus.text,
    liveGame: game.text
  });

  return Object.freeze({
    serverId,
    prefix,
    readOnly: true,
    changed: diff.gameUserSettings.length > 0 || diff.game.length > 0,
    paths: Object.freeze({
      gameUserSettings: gus.remoteFile,
      game: game.remoteFile
    }),
    diff
  });
}

module.exports = { captureLiveConfigDiff };

'use strict';

let installed = false;

function install() {
  if (installed) return;
  installed = true;
  const target = require('./services/status-panel-service.cjs');
  const Original = target.StatusPanelService;
  if (!Original || Original.__khaosSatisfactoryPatched) return;
  const { normalizeStatusPanel, normalizeStatusSnapshot } = require('../shared/status-panels.cjs');
  const { createCurrentServerAdapter } = require('../bot/game-adapters/current-server-adapter.cjs');
  const { executeAdapterOperation } = require('../shared/game-adapter-sdk.cjs');

  class SatisfactoryStatusPanelService extends Original {
    server(serverId) {
      const server = super.server(serverId);
      if (String(server.game || '').toLowerCase() === 'satisfactory') {
        const runtime = this.bootstrap().config.moduleRuntime?.['satisfactory-server-operations'];
        if (runtime && !runtime.effectiveEnabled) throw new Error('Satisfactory HTTPS API operations are disabled by the Khaos Nexus owner.');
        if (!server.tlsFingerprint) throw new Error('Trust the Satisfactory server TLS certificate before publishing its status panel.');
      }
      return server;
    }

    async snapshot(panelInput) {
      const panel = normalizeStatusPanel(panelInput);
      const server = this.server(panel.serverId);
      if (String(server.game || '').toLowerCase() !== 'satisfactory') return super.snapshot(panelInput);
      const adapter = this.adapterFactory ? this.adapterFactory(server) : createCurrentServerAdapter(server, { logger: this.logger });
      const context = { role: 'viewer', explicitSecrets: [server.password] };
      let statusResult = null;
      let playerResult = null;
      let statusError = null;
      let playerError = null;
      try { statusResult = (await executeAdapterOperation(adapter, 'status', {}, context)).data; } catch (error) { statusError = error; }
      try { playerResult = (await executeAdapterOperation(adapter, 'players', {}, context)).data; } catch (error) { playerError = error; }
      if (statusError && playerError) {
        return normalizeStatusSnapshot({
          status: 'offline',
          serverName: server.name,
          game: 'satisfactory',
          connectionLabel: 'Satisfactory HTTPS API',
          checkedAt: this.now().toISOString(),
          error: 'The Satisfactory HTTPS and lightweight query APIs did not respond.'
        });
      }
      const state = String(statusResult?.state || '').toLowerCase();
      const loading = state === 'loading';
      const playerCount = Number(statusResult?.players ?? playerResult?.count ?? 0) || 0;
      const maxPlayers = Number(statusResult?.maxPlayers ?? playerResult?.maxPlayers ?? 0) || 0;
      return normalizeStatusSnapshot({
        status: loading ? 'degraded' : (statusError || playerError ? 'degraded' : 'online'),
        serverName: statusResult?.serverName || server.name,
        game: 'satisfactory',
        connectionLabel: 'Satisfactory HTTPS API',
        version: statusResult?.serverNetCl ? `CL ${statusResult.serverNetCl}` : '',
        players: playerCount,
        maxPlayers,
        map: statusResult?.sessionName || statusResult?.gamePhase || state,
        playerNames: [],
        checkedAt: this.now().toISOString(),
        error: loading
          ? 'The server is loading a save or changing maps; HTTPS operations are temporarily unavailable.'
          : (statusError || playerError ? 'One Satisfactory status source did not respond; the remaining live data is shown.' : '')
      });
    }
  }

  Object.defineProperty(SatisfactoryStatusPanelService, '__khaosSatisfactoryPatched', { value: true });
  target.StatusPanelService = SatisfactoryStatusPanelService;

  const originalRequired = target.requiredGameModule;
  target.requiredGameModule = (server = {}) => String(server.game || '').toLowerCase() === 'satisfactory'
    ? 'satisfactory-server-operations'
    : originalRequired(server);
  const originalLabel = target.connectionLabel;
  target.connectionLabel = (server = {}) => String(server.game || '').toLowerCase() === 'satisfactory'
    ? 'Satisfactory HTTPS API'
    : originalLabel(server);
}

module.exports = { install };
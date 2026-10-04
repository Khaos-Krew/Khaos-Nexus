'use strict';

function resolveSharedListenerPorts(env = {}) {
  const railwayPort = String(env.PORT || '').trim();
  const token = String(env.NEXUS_SENTINAL_ADMIN_TOKEN || env.NEXUS_SENTINEL_ADMIN_TOKEN || '').trim();
  const railwayAdmin = Boolean(token && railwayPort);
  const adminPort = String(env.NEXUS_SENTINAL_ADMIN_PORT || (railwayAdmin ? railwayPort : '3220')).trim();
  let backendPort = String(env.NEXUS_BACKEND_PORT || '3210').trim();
  let movedBackend = false;
  if (adminPort && backendPort === adminPort) {
    backendPort = adminPort === '3212' ? '3213' : '3212';
    movedBackend = true;
  }
  const warning = movedBackend
    ? `[Nexus Sentinal Admin] public listener 0.0.0.0:${adminPort} collides with the backend port; backend will listen on 127.0.0.1:${backendPort}.`
    : '';
  return { adminPort, backendPort, movedBackend, warning };
}

module.exports = { resolveSharedListenerPorts };

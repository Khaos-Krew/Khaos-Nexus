import type {
  HealthSnapshot,
  NexusApiErrorPayload,
  ReadinessSnapshot,
  SessionSnapshot
} from './contracts';

const dataMode = import.meta.env.VITE_NEXUS_DATA_MODE ?? 'live';
const apiBase = (import.meta.env.VITE_NEXUS_API_BASE_URL ?? '/api/v1').replace(/\/$/, '');

export const nexusClientConfig = {
  dataMode,
  apiBase,
  environment: import.meta.env.VITE_NEXUS_ENV ?? 'development'
} as const;

export class NexusApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;

  constructor(status: number, payload: NexusApiErrorPayload) {
    super(payload.message);
    this.name = 'NexusApiError';
    this.status = status;
    this.code = payload.code;
    this.requestId = payload.requestId;
  }
}

function stubHealth(): HealthSnapshot {
  const checkedAt = new Date().toISOString();
  return {
    apiVersion: 'v1',
    environment: nexusClientConfig.environment,
    generatedAt: checkedAt,
    services: [
      {
        id: 'nexus-api',
        name: 'Nexus API',
        summary: 'Versioned development contract is active. Production credentials are not attached.',
        state: 'online',
        checkedAt,
        version: 'v1-stub'
      },
      {
        id: 'sentinel',
        name: 'Nexus Sentinel',
        summary: 'Read-only health adapter is reserved; no production Discord writes are enabled.',
        state: 'unknown',
        checkedAt
      },
      {
        id: 'game-services',
        name: 'Game Services',
        summary: 'Backend-first game modules will report aggregate health through this contract.',
        state: 'unknown',
        checkedAt
      },
      {
        id: 'private-capability',
        name: 'Private Capability Gateway',
        summary: 'Server-side capability enforcement is required before any private surface is exposed.',
        state: 'unknown',
        checkedAt
      }
    ]
  };
}

function stubSession(): SessionSnapshot {
  return {
    authenticated: false,
    user: null
  };
}

function stubReadiness(): ReadinessSnapshot {
  return {
    environment: nexusClientConfig.environment,
    releaseLabel: 'Under Development',
    ready: false,
    readyCount: 0,
    totalCount: 5,
    checks: [
      { id: 'discord-client', label: 'Discord OAuth client', ready: false },
      { id: 'discord-secret', label: 'Discord OAuth secret', ready: false },
      { id: 'session-secret', label: 'Session signing secret', ready: false },
      { id: 'owner-allowlist', label: 'Owner allowlist', ready: false },
      { id: 'staff-allowlist', label: 'Staff allowlist', ready: false }
    ]
  };
}

async function getJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, {
    method: 'GET',
    credentials: 'include',
    headers: {
      Accept: 'application/json'
    },
    signal
  });

  if (!response.ok) {
    let payload: NexusApiErrorPayload = {
      code: 'request_failed',
      message: `Nexus API request failed with HTTP ${response.status}.`
    };

    try {
      payload = (await response.json()) as NexusApiErrorPayload;
    } catch {
      // Keep the safe fallback payload when the server did not return JSON.
    }

    throw new NexusApiError(response.status, payload);
  }

  return (await response.json()) as T;
}

export async function getHealthSnapshot(signal?: AbortSignal): Promise<HealthSnapshot> {
  if (dataMode === 'stub') return stubHealth();
  return getJson<HealthSnapshot>('/health', signal);
}

export async function getSessionSnapshot(signal?: AbortSignal): Promise<SessionSnapshot> {
  if (dataMode === 'stub') return stubSession();
  return getJson<SessionSnapshot>('/session', signal);
}

export async function getReadinessSnapshot(signal?: AbortSignal): Promise<ReadinessSnapshot> {
  if (dataMode === 'stub') return stubReadiness();
  return getJson<ReadinessSnapshot>('/config', signal);
}

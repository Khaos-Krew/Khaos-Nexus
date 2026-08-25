export type ServiceState = 'online' | 'degraded' | 'offline' | 'unknown';

export type ServiceHealth = {
  id: string;
  name: string;
  summary: string;
  state: ServiceState;
  checkedAt: string;
  version?: string;
};

export type HealthSnapshot = {
  apiVersion: 'v1';
  environment: string;
  generatedAt: string;
  services: ServiceHealth[];
};

export type NexusUser = {
  id: string;
  displayName: string;
  avatarUrl?: string;
  roles: string[];
  capabilities: string[];
};

export type SessionSnapshot = {
  authenticated: boolean;
  user: NexusUser | null;
  expiresAt?: string;
};

export type NexusApiErrorPayload = {
  code: string;
  message: string;
  requestId?: string;
};

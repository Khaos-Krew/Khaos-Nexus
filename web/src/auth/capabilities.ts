import type { SessionSnapshot } from '../api/contracts';

export const capabilities = {
  dashboardRead: 'nexus.dashboard.read',
  servicesRead: 'nexus.services.read',
  accountRead: 'nexus.account.read',
  adminRead: 'nexus.admin.read',
  adminWrite: 'nexus.admin.write',
  privateAccess: 'nexus.private.access'
} as const;

export type NexusCapability = (typeof capabilities)[keyof typeof capabilities];

export function hasCapability(
  session: SessionSnapshot | null,
  capability: NexusCapability
): boolean {
  return Boolean(
    session?.authenticated &&
      session.user?.capabilities.includes(capability)
  );
}

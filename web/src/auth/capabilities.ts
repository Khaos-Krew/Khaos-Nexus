import type { SessionSnapshot } from '../api/contracts';

export const capabilities = {
  webAccess: 'nexus.web.access',
  staffAccess: 'nexus.staff.access',
  adminAccess: 'nexus.admin',
  privateAccess: 'nexus.private.access',
  dashboardRead: 'nexus.dashboard.read',
  servicesRead: 'nexus.services.read',
  accountRead: 'nexus.account.read',
  adminRead: 'nexus.admin.read',
  adminWrite: 'nexus.admin.write'
} as const;

export type NexusCapability = (typeof capabilities)[keyof typeof capabilities];

export function hasCapability(
  session: SessionSnapshot | null,
  capability: NexusCapability
): boolean {
  return Boolean(session?.authenticated && session.user?.capabilities.includes(capability));
}

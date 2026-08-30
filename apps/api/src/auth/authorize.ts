import type { Session, SessionRole } from "./session.js";

export function requireRole(session: Session | null, roles: SessionRole[]): boolean {
  return session !== null && roles.includes(session.role);
}

export function sameTenant(session: Session, resource: { tenantId?: string | null }): boolean {
  return resource.tenantId === undefined || resource.tenantId === null || resource.tenantId === session.tenantId;
}

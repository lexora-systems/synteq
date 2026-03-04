import type { UserRole } from "@prisma/client";

export enum Permission {
  DASHBOARD_VIEW = "DASHBOARD_VIEW",
  INCIDENTS_READ = "INCIDENTS_READ",
  INCIDENTS_WRITE = "INCIDENTS_WRITE",
  WORKFLOWS_READ = "WORKFLOWS_READ",
  WORKFLOWS_WRITE = "WORKFLOWS_WRITE",
  POLICIES_READ = "POLICIES_READ",
  POLICIES_WRITE = "POLICIES_WRITE",
  TEAM_READ = "TEAM_READ",
  TEAM_INVITE = "TEAM_INVITE",
  TEAM_MANAGE = "TEAM_MANAGE",
  BILLING_MANAGE = "BILLING_MANAGE",
  SETTINGS_MANAGE = "SETTINGS_MANAGE"
}

const allPermissions = Object.values(Permission);

const rolePermissionMap: Record<UserRole, Set<Permission>> = {
  owner: new Set(allPermissions),
  admin: new Set(
    allPermissions.filter((permission) => {
      return permission !== Permission.BILLING_MANAGE;
    })
  ),
  engineer: new Set([
    Permission.DASHBOARD_VIEW,
    Permission.INCIDENTS_READ,
    Permission.INCIDENTS_WRITE,
    Permission.WORKFLOWS_READ,
    Permission.WORKFLOWS_WRITE,
    Permission.POLICIES_READ,
    Permission.POLICIES_WRITE
  ]),
  viewer: new Set([
    Permission.DASHBOARD_VIEW,
    Permission.INCIDENTS_READ,
    Permission.WORKFLOWS_READ,
    Permission.POLICIES_READ
  ])
};

export function getPermissionsForRole(role: UserRole): Set<Permission> {
  return rolePermissionMap[role] ?? new Set<Permission>();
}

export function hasRequiredPermissions(role: UserRole, requiredPermissions: Permission[]): boolean {
  const granted = getPermissionsForRole(role);
  return requiredPermissions.every((permission) => granted.has(permission));
}

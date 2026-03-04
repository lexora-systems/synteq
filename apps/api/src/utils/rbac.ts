import type { UserRole } from "@prisma/client";

export function hasRequiredRole(role: UserRole, allowedRoles: UserRole[]) {
  return allowedRoles.includes(role);
}

/**
 * Authorization & Permission Service
 * Handles role verification and permission checking
 */

import type { UserRole } from "../types/roles";
import { hasPermission, getRoleDashboard } from "../types/roles";

export interface AuthContext {
  walletAddress: string;
  roles: UserRole[];
  isAuthenticated: boolean;
}

/**
 * Verify if user has permission for an action
 */
export function checkPermission(
  roles: UserRole[],
  resource: string,
  action: "create" | "read" | "update" | "delete" | "manage"
): boolean {
  return roles.some((role) => hasPermission(role, resource, action));
}

/**
 * Get all accessible resources for a user
 */
export function getAccessibleResources(roles: UserRole[]): string[] {
  const resources = new Set<string>();

  roles.forEach((role) => {
    // Add role-specific permissions
    if (role === "admin") {
      resources.add("properties");
      resources.add("pools");
      resources.add("users");
      resources.add("financial");
      resources.add("system");
    }

    if (role === "srl") {
      resources.add("properties");
      resources.add("pools");
      resources.add("acquisition_docs");
      resources.add("hardware_specs");
      resources.add("financial");
    }

    if (role === "investor") {
      resources.add("pools");
      resources.add("contributions");
      resources.add("financial");
      resources.add("portfolio");
    }

    if (role === "compute_user") {
      resources.add("compute_offers");
      resources.add("rentals");
      resources.add("usage");
    }
  });

  return Array.from(resources);
}

/**
 * Determine primary dashboard for user based on roles
 * Priority: admin > srl > investor > compute_user
 */
export function getPrimaryDashboard(roles: UserRole[]): string {
  const priorityOrder: UserRole[] = ["admin", "srl", "investor", "compute_user"];

  for (const role of priorityOrder) {
    if (roles.includes(role)) {
      return getRoleDashboard(role);
    }
  }

  return "/home";
}

/**
 * Middleware to enforce role-based access
 */
export function requireRole(allowedRoles: UserRole[], roles: UserRole[]): boolean {
  return roles.some((role) => allowedRoles.includes(role));
}

/**
 * Validate wallet is authorized as SRL member
 */
export function isSRLMember(roles: UserRole[]): boolean {
  return roles.includes("srl");
}

/**
 * Validate wallet is investor
 */
export function isInvestor(roles: UserRole[]): boolean {
  return roles.includes("investor");
}

/**
 * Validate wallet is compute user
 */
export function isComputeUser(roles: UserRole[]): boolean {
  return roles.includes("compute_user");
}

/**
 * Validate wallet is platform admin
 */
export function isAdmin(roles: UserRole[]): boolean {
  return roles.includes("admin");
}

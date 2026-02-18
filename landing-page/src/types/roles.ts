/**
 * Role-Based Access Control System
 * Defines user roles and their permissions in ComputeBasin
 */

export type UserRole = "admin" | "srl" | "investor" | "compute_user" | "guest";

export interface Permission {
  resource: string;
  action: "create" | "read" | "update" | "delete" | "manage";
}

export interface RoleDefinition {
  name: UserRole;
  label: string;
  description: string;
  permissions: Permission[];
  dashboard: string;
}

/**
 * Role Definitions
 * Each role has specific permissions and dashboard access
 */
export const ROLE_DEFINITIONS: Record<UserRole, RoleDefinition> = {
  admin: {
    name: "admin",
    label: "Admin",
    description: "Platform administrator with full access",
    permissions: [
      { resource: "properties", action: "manage" },
      { resource: "pools", action: "manage" },
      { resource: "users", action: "manage" },
      { resource: "financial", action: "read" },
      { resource: "system", action: "manage" },
    ],
    dashboard: "/admin",
  },

  srl: {
    name: "srl",
    label: "SRL Member",
    description: "Property owner/manager - uploads properties and manages acquisition",
    permissions: [
      { resource: "properties", action: "create" },
      { resource: "properties", action: "update" },
      { resource: "pools", action: "create" },
      { resource: "pools", action: "read" },
      { resource: "acquisition_docs", action: "create" },
      { resource: "hardware_specs", action: "create" },
      { resource: "financial", action: "read" },
    ],
    dashboard: "/srl",
  },

  investor: {
    name: "investor",
    label: "Investor",
    description: "Contributes capital to pools and receives revenue share",
    permissions: [
      { resource: "pools", action: "read" },
      { resource: "contributions", action: "create" },
      { resource: "financial", action: "read" },
      { resource: "portfolio", action: "read" },
    ],
    dashboard: "/investor",
  },

  compute_user: {
    name: "compute_user",
    label: "Compute User",
    description: "Rents compute resources from operational infrastructure",
    permissions: [
      { resource: "compute_offers", action: "read" },
      { resource: "rentals", action: "create" },
      { resource: "usage", action: "read" },
    ],
    dashboard: "/compute",
  },

  guest: {
    name: "guest",
    label: "Guest",
    description: "Public user - view-only access",
    permissions: [
      { resource: "pools", action: "read" },
      { resource: "compute_offers", action: "read" },
    ],
    dashboard: "/home",
  },
};

export function hasPermission(role: UserRole, resource: string, action: Permission["action"]): boolean {
  const roleDef = ROLE_DEFINITIONS[role];
  if (!roleDef) return false;

  return roleDef.permissions.some((p) => p.resource === resource && (p.action === action || p.action === "manage"));
}

export function getRoleDashboard(role: UserRole): string {
  return ROLE_DEFINITIONS[role]?.dashboard || "/home";
}

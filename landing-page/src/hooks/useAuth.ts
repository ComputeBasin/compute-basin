/**
 * Custom Hook: useAuth
 * Manages user authentication state and roles
 */

import { useEffect, useState } from "react";
import { useCurrentAccount } from "@iota/dapp-kit";
import type { UserRole } from "../types/roles";
import { getPrimaryDashboard, checkPermission } from "../services/auth";
import { fetchUserRoles } from "../services/api";

export interface AuthState {
  walletAddress: string | null;
  roles: UserRole[];
  isAuthenticated: boolean;
  isLoading: boolean;
  error: string | null;
}

/**
 * Hook to get current user authentication state and roles
 * In production, roles would be fetched from backend after wallet verification
 */
export function useAuth(): AuthState & {
  hasPermission: (resource: string, action: "create" | "read" | "update" | "delete" | "manage") => boolean;
  getPrimaryDashboard: () => string;
} {
  const account = useCurrentAccount();
  const walletAddress = account?.address?.toLowerCase() || null;

  const [roles, setRoles] = useState<UserRole[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Fetch user roles from backend
   * Calls API endpoint to get roles based on wallet address
   */
  useEffect(() => {
    if (!walletAddress) {
      setRoles([]);
      return;
    }

    async function fetchRoles() {
      try {
        setIsLoading(true);
        setError(null);

        const response = await fetchUserRoles(walletAddress!);
        setRoles(response.roles.length > 0 ? response.roles : ["guest"]);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to fetch roles");
        setRoles(["guest"]);
      } finally {
        setIsLoading(false);
      }
    }

    fetchRoles();
  }, [walletAddress]);

  return {
    walletAddress,
    roles,
    isAuthenticated: roles.length > 0 && roles[0] !== "guest",
    isLoading,
    error,
    hasPermission: (resource, action) => checkPermission(roles, resource, action),
    getPrimaryDashboard: () => getPrimaryDashboard(roles),
  };
}

/**
 * Hook to check if user has specific role
 */
export function useRole(requiredRoles: UserRole[]): boolean {
  const { roles } = useAuth();
  return roles.some((role) => requiredRoles.includes(role));
}

/**
 * Hook to check if user can perform specific action
 */
export function usePermission(resource: string, action: "create" | "read" | "update" | "delete" | "manage"): boolean {
  const auth = useAuth();
  return auth.hasPermission(resource, action);
}

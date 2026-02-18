import type { UserRole } from "../../types/roles";
import { fetchJson, withWallet } from "./client";

export async function fetchUserRoles(walletAddress: string) {
  return fetchJson<{
    walletAddress: string;
    roles: UserRole[];
    kycStatus: "pending" | "verified" | "rejected";
  }>("/auth/roles", withWallet(walletAddress));
}
